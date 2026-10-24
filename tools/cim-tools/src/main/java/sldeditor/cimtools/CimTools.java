package sldeditor.cimtools;

import com.powsybl.commons.report.ReportConstants;
import com.powsybl.commons.report.ReportNode;
import com.powsybl.computation.local.LocalComputationManager;
import com.powsybl.ieeecdf.converter.IeeeCdfNetworkFactory;
import com.powsybl.iidm.network.ImportConfig;
import com.powsybl.iidm.network.ImportersServiceLoader;
import com.powsybl.iidm.network.Network;
import com.powsybl.iidm.network.Substation;
import com.powsybl.iidm.network.Switch;
import com.powsybl.iidm.network.VoltageLevel;
import com.powsybl.sld.SingleLineDiagram;
import com.powsybl.sld.SldParameters;
import com.powsybl.sld.svg.SvgParameters;

import java.io.IOException;
import java.io.StringWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.function.Supplier;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * PowSyBl counterpart of the SLD editor's CIM export/import.
 * <ul>
 *   <li>{@code check <model>...}: imports each model, prints what PowSyBl built and its import report; exit 1 if any failed.</li>
 *   <li>{@code render <model> <dir>}: one PowSyBl single-line SVG per substation (and per voltage level outside one).</li>
 *   <li>{@code to-cgmes <model|ieee9|ieee14|ieee30|ieee57|ieee118|ieee300> <out.zip>}: writes a CGMES 3.0 zip.</li>
 *   <li>{@code layout <model> <out.zip>}: the model's documents plus a Diagram Layout of PowSyBl's own layout, a diagram per
 *   substation (see {@link DlLayout}).</li>
 * </ul>
 * A model is any file PowSyBl can import: a CGMES zip (such as the editor's export), XIIDM, IEEE CDF or MATPOWER.
 */
public final class CimTools {

    private static final Map<String, Supplier<Network>> SAMPLES = Map.of(
            "ieee9", IeeeCdfNetworkFactory::create9,
            "ieee14", IeeeCdfNetworkFactory::create14,
            "ieee30", IeeeCdfNetworkFactory::create30,
            "ieee57", IeeeCdfNetworkFactory::create57,
            "ieee118", IeeeCdfNetworkFactory::create118,
            "ieee300", IeeeCdfNetworkFactory::create300);

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            usage();
        }
        int code;
        try {
            code = switch (args[0]) {
                case "check" -> check(Stream.of(args).skip(1).toList());
                case "render" -> args.length == 3 ? render(Path.of(args[1]), Path.of(args[2])) : usage();
                case "to-cgmes" -> args.length == 3 ? toCgmes(args[1], Path.of(args[2])) : usage();
                case "layout" -> args.length == 3 ? layout(Path.of(args[1]), Path.of(args[2])) : usage();
                default -> usage();
            };
        } catch (ModelException e) {
            System.err.println("cim-tools: " + e.getMessage());
            System.err.println("  (java -jar cim-tools.jar check -v <model> prints PowSyBl's import report)");
            code = 1;
        }
        System.exit(code);
    }

    /** A model PowSyBl could not import: its message names the file and why. */
    static final class ModelException extends RuntimeException {
        ModelException(Path model, Exception cause) {
            super("cannot import " + model + ": " + cause.getMessage(), cause);
        }
    }

    /**
     * readModel imports a model with PowSyBl.
     *
     * @param model the model file
     * @return the network
     * @throws ModelException when PowSyBl can't import it (a file that isn't a valid model, such as a busbar with
     *                        several terminals or a voltage level of a substation it can't create)
     */
    static Network readModel(Path model) {
        try {
            return Network.read(model);
        } catch (RuntimeException e) {
            throw new ModelException(model, e);
        }
    }

    private static int usage() {
        System.err.println("""
                usage: java -jar cim-tools.jar check [-v] <model>...
                       java -jar cim-tools.jar render <model> <output-dir>
                       java -jar cim-tools.jar to-cgmes <model|ieee9|ieee14|ieee30|ieee57|ieee118|ieee300> <out.zip>
                       java -jar cim-tools.jar layout <model> <out.zip>""");
        System.exit(2);
        return 2;
    }

    /** check prints, for each file, the network PowSyBl built from it and the import report; returns 1 if any import failed. */
    private static int check(List<String> args) {
        boolean verbose = args.contains("-v");
        List<Path> files = args.stream().filter(a -> !a.equals("-v")).map(Path::of).toList();
        int failed = 0;
        for (Path file : files) {
            System.out.println("=== " + file.getFileName());
            ReportNode report = ReportNode.newRootReportNode()
                    .withAllResourceBundlesFromClasspath()
                    .withMessageTemplate("core.iidm.network.importDataSource")
                    .withUntypedValue("dataSource", file.getFileName().toString())
                    .build();
            try {
                Network n = Network.read(file, LocalComputationManager.getDefault(), ImportConfig.load(), new Properties(),
                        new ImportersServiceLoader(), report);
                System.out.printf("  substations %d, voltage levels %d, busbars %d, switches %d (open %d), lines %d,%n"
                                + "  transformers 2W %d / 3W %d, generators %d, loads %d, shunts %d, SVCs %d, buses %d%n",
                        n.getSubstationCount(), n.getVoltageLevelCount(), n.getBusbarSectionCount(), n.getSwitchCount(),
                        n.getSwitchStream().filter(Switch::isOpen).count(), n.getLineCount(),
                        n.getTwoWindingsTransformerCount(), n.getThreeWindingsTransformerCount(), n.getGeneratorCount(),
                        n.getLoadCount(), n.getShuntCompensatorCount(), n.getStaticVarCompensatorCount(),
                        n.getBusView().getBusStream().count());
            } catch (Exception e) {
                failed++;
                System.out.println("  FAILED: " + e.getMessage());
            }
            if (verbose) {
                StringWriter w = new StringWriter();
                try {
                    report.print(w);
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
                w.toString().lines().filter(l -> !l.isBlank()).forEach(l -> System.out.println("  | " + l));
            } else {
                printProblems(report);
            }
        }
        return failed == 0 ? 0 : 1;
    }

    /** printProblems prints the report entries of severity WARN or ERROR, or a line saying there are none. */
    private static void printProblems(ReportNode report) {
        List<String> lines = new ArrayList<>();
        collectProblems(report, lines);
        if (lines.isEmpty()) {
            System.out.println("  no import warnings");
        }
        lines.forEach(l -> System.out.println("  | " + l));
    }

    private static void collectProblems(ReportNode node, List<String> lines) {
        node.getValue(ReportConstants.SEVERITY_KEY).map(v -> String.valueOf(v.getValue()))
                .filter(sev -> sev.equals("WARN") || sev.equals("ERROR"))
                .ifPresent(sev -> lines.add(sev + " " + node.getMessage()));
        node.getChildren().forEach(c -> collectProblems(c, lines));
    }

    /** render writes dir/NN_name.svg for each substation and each voltage level not inside one; returns 0. */
    private static int render(Path model, Path dir) throws IOException {
        Network n = readModel(model);
        Files.createDirectories(dir);
        SldParameters params = new SldParameters().setSvgParameters(new SvgParameters().setUseName(true));
        int k = 0;
        for (Substation s : n.getSubstations()) {
            Path svg = dir.resolve(fileName(k++, s.getNameOrId()));
            SingleLineDiagram.draw(n, s.getId(), svg, params);
            System.out.println(svg);
        }
        for (VoltageLevel vl : n.getVoltageLevels()) {
            if (vl.getSubstation().isEmpty()) {
                Path svg = dir.resolve(fileName(k++, vl.getNameOrId()));
                SingleLineDiagram.draw(n, vl.getId(), svg, params);
                System.out.println(svg);
            }
        }
        System.out.printf("%d diagrams in %s%n", k, dir);
        return 0;
    }

    /** toCgmes writes the model (a file, or a built-in IEEE test network) as a CGMES 3.0 zip; returns 0. */
    private static int toCgmes(String source, Path zip) throws IOException {
        Network n = SAMPLES.containsKey(source) ? SAMPLES.get(source).get() : readModel(Path.of(source));
        Path tmp = Files.createTempDirectory("cim-tools");
        try {
            Properties p = new Properties();
            p.put("iidm.export.cgmes.cim-version", "100");
            String base = zip.getFileName().toString().replaceFirst("\\.zip$", "");
            n.write("CGMES", p, tmp.resolve(base));
            try (ZipOutputStream z = new ZipOutputStream(Files.newOutputStream(zip)); Stream<Path> files = Files.list(tmp)) {
                for (Path f : files.sorted().toList()) {
                    z.putNextEntry(new ZipEntry(f.getFileName().toString()));
                    Files.copy(f, z);
                    z.closeEntry();
                }
            }
        } finally {
            try (Stream<Path> files = Files.walk(tmp)) {
                files.sorted(Comparator.reverseOrder()).forEach(f -> f.toFile().delete());
            }
        }
        System.out.printf("%s: substations %d, voltage levels %d, lines %d, transformers %d -> %s%n", source,
                n.getSubstationCount(), n.getVoltageLevelCount(), n.getLineCount(),
                n.getTwoWindingsTransformerCount() + n.getThreeWindingsTransformerCount(), zip);
        return 0;
    }

    /** layout writes zip: model's documents and a Diagram Layout from PowSyBl's single-line layout; returns 0. */
    private static int layout(Path model, Path zip) throws IOException {
        int diagrams = DlLayout.run(model, zip);
        System.out.printf("%s: %d diagrams laid out by PowSyBl -> %s%n", model.getFileName(), diagrams, zip);
        return 0;
    }

    private static String fileName(int k, String name) {
        return String.format("%02d_%s.svg", k, name.replaceAll("[^\\p{L}\\p{N}._-]+", "_"));
    }
}
