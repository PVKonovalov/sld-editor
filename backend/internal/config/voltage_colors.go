package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// AppendVoltageColors adds add to the voltage_colors list of the YAML file at path, as text after the list's last
// entry, so the file's comments and layout stay as they are; a file without the key gets it at the end. The file is
// replaced atomically, and only after the result reads back with every entry in it.
func AppendVoltageColors(path string, add []VoltageColor) error {
	if len(add) == 0 {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	var before Config
	if err := yaml.Unmarshal(data, &before); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}

	text := string(data)
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	lines := strings.SplitAfter(text, "\n")
	entries := func(indent string) string {
		var b strings.Builder
		for _, vc := range add {
			fmt.Fprintf(&b, "%s- name: %s\n%s  color: %s\n", indent, strconv.Quote(vc.Name), indent, strconv.Quote(vc.Color))
		}
		return b.String()
	}

	seq := mappingValue(&root, "voltage_colors")
	switch {
	case seq == nil:
		text += "\nvoltage_colors:\n" + entries("  ")
	case seq.Kind == yaml.SequenceNode && seq.Style&yaml.FlowStyle == 0 && len(seq.Content) > 0:
		first := lines[seq.Content[0].Line-1]
		indent := first[:len(first)-len(strings.TrimLeft(first, " "))]
		last := lastLine(seq.Content[len(seq.Content)-1])
		text = strings.Join(lines[:last], "") + entries(indent) + strings.Join(lines[last:], "")
	default:
		return fmt.Errorf("%s: voltage_colors is not a block list, add the presets by hand", path)
	}

	var after Config
	if err := yaml.Unmarshal([]byte(text), &after); err != nil || len(after.VoltageColors) != len(before.VoltageColors)+len(add) {
		return fmt.Errorf("%s: could not add to voltage_colors, add the presets by hand", path)
	}
	return writeAtomic(path, []byte(text))
}

// mappingValue is the value node of key in the document's top-level mapping, or nil.
func mappingValue(doc *yaml.Node, key string) *yaml.Node {
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil
	}
	m := doc.Content[0]
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	return nil
}

// lastLine is the highest (1-based) line any part of n is on.
func lastLine(n *yaml.Node) int {
	line := n.Line
	for _, c := range n.Content {
		line = max(line, lastLine(c))
	}
	return line
}

// writeAtomic replaces path with data through a temporary file in the same directory, keeping path's mode.
func writeAtomic(path string, data []byte) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), info.Mode().Perm()); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
