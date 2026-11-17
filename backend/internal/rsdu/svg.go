package rsdu

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"sld-editor/internal/config"
)

// svgSink is one place ctrlroom reads scheme pictures from.
type svgSink interface {
	// put stores svg as file (a path relative to the place, "/"-separated) and returns where it went.
	put(ctx context.Context, file string, svg []byte) (string, error)
}

// dirSink is ctrlroom's backend.path_to_sld.
type dirSink struct{ dir string }

func (s dirSink) put(_ context.Context, file string, svg []byte) (string, error) {
	target := filepath.Join(s.dir, filepath.FromSlash(file))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", fmt.Errorf("rsdu: svg: %w", err)
	}
	f, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".*.tmp")
	if err != nil {
		return "", fmt.Errorf("rsdu: svg: %w", err)
	}
	tmp := f.Name()
	_, err = f.Write(svg)
	err = errors.Join(err, f.Close())
	if err == nil {
		err = os.Chmod(tmp, 0o644)
	}
	if err == nil {
		err = os.Rename(tmp, target)
	}
	if err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("rsdu: svg: %w", err)
	}
	return target, nil
}

// minioSink is ctrlroom's object storage bucket (use_object_storage: minio); the object name is the file. The object
// is put in one request with an unsigned payload: S3-like stores that ctrlroom reads from don't all take
// aws-chunked uploads.
type minioSink struct {
	client *minio.Client
	bucket string
}

func newMinioSink(m config.Minio) (*minioSink, error) {
	c, err := minio.New(m.Address(), &minio.Options{Creds: credentials.NewStaticV4(m.AccessKey(), m.Password, ""), Secure: bool(m.Secure)})
	if err != nil {
		return nil, fmt.Errorf("rsdu: bindings.rsdu.svg.object_storage.minio: %w", err)
	}
	return &minioSink{client: c, bucket: m.SLDBucket()}, nil
}

func (s *minioSink) put(ctx context.Context, file string, svg []byte) (string, error) {
	_, err := s.client.PutObject(ctx, s.bucket, file, bytes.NewReader(svg), int64(len(svg)),
		minio.PutObjectOptions{ContentType: "image/svg+xml", DisableContentSha256: true})
	if err != nil {
		return "", fmt.Errorf("rsdu: svg to bucket %s: %w", s.bucket, err)
	}
	return fmt.Sprintf("minio:%s/%s", s.bucket, file), nil
}

// svgSinks are the places of cfg.SVG: its folder when set, its Minio bucket with use_object_storage: minio.
func svgSinks(cfg config.RSDUBindings) ([]svgSink, error) {
	var sinks []svgSink
	if cfg.SVG.Dir != "" {
		sinks = append(sinks, dirSink{dir: cfg.SVG.Dir})
	}
	if cfg.UsesMinio() {
		m, err := newMinioSink(cfg.SVG.ObjectStorage.Minio)
		if err != nil {
			return nil, err
		}
		sinks = append(sinks, m)
	}
	return sinks, nil
}

// DeliverSVG writes svg where ctrlroom's PathToSld looks for scheme ref: VS_FORM.FILE_NAME resolved by
// svg.full_path, under svg.dir and in the svg.object_storage Minio bucket. It refuses a file another scheme resolves to
// as well (letter case ignored), so as not to replace that scheme's picture. It stops at the first place that fails.
func (p *Provider) DeliverSVG(ctx context.Context, ref string, svg []byte) ([]string, error) {
	if len(p.sinks) == 0 {
		return nil, nil
	}
	s, err := p.Scheme(ctx, ref)
	if err != nil {
		return nil, err
	}
	file, err := svgFile(s.FileName, p.cfg.SVG.FullPath)
	if err != nil {
		return nil, fmt.Errorf("rsdu: scheme %s: %w", ref, err)
	}
	all, err := p.allSchemes(ctx)
	if err != nil {
		return nil, err
	}
	if clash := svgClash(file, ref, all, p.cfg.SVG.FullPath); len(clash) > 0 {
		return nil, fmt.Errorf("rsdu: %s is also the SVG of scheme %s (%s); not delivered", file, clash[0].Ref, clash[0].Name)
	}
	var where []string
	for _, sink := range p.sinks {
		w, err := sink.put(ctx, file, svg)
		if err != nil {
			return where, err
		}
		where = append(where, w)
	}
	return where, nil
}
