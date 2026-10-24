package sldeditor.cimtools;

import com.powsybl.iidm.network.Identifiable;
import com.powsybl.iidm.network.Network;
import com.powsybl.iidm.network.Substation;
import com.powsybl.iidm.network.VoltageLevel;
import com.powsybl.sld.SldParameters;
import com.powsybl.sld.builders.NetworkGraphBuilder;
import com.powsybl.sld.layout.LayoutParameters;
import com.powsybl.sld.model.coordinate.Orientation;
import com.powsybl.sld.model.coordinate.Point;
import com.powsybl.sld.model.graphs.Graph;
import com.powsybl.sld.model.graphs.SubstationGraph;
import com.powsybl.sld.model.graphs.VoltageLevelGraph;
import com.powsybl.sld.model.nodes.BranchEdge;
import com.powsybl.sld.model.nodes.BusNode;
import com.powsybl.sld.model.nodes.Edge;
import com.powsybl.sld.model.nodes.EquipmentNode;
import com.powsybl.sld.model.nodes.FeederNode;
import com.powsybl.sld.model.nodes.FeederType;
import com.powsybl.sld.model.nodes.MiddleTwtNode;
import com.powsybl.sld.model.nodes.Node;
import com.powsybl.sld.model.nodes.SwitchNode;
import com.powsybl.sld.model.nodes.feeders.FeederWithSides;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import javax.xml.stream.XMLStreamReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * The {@code layout} command: PowSyBl's single-line layout of every substation (and every voltage level outside one)
 * written as a CGMES 3.0 Diagram Layout, one Diagram per substation named after it, next to the model's own documents.
 * Busbars, switches, injections and transformers become DiagramObjects at PowSyBl's positions; each drawn connection
 * becomes a polyline of the terminal it leaves (a Terminal DiagramObject) or, between two junctions, of its
 * ConnectivityNode; a line end becomes a short ACLineSegment polyline out of its bay. Feeders, lines, transformers and
 * busbars are named with TextDiagramObjects.
 */
final class DlLayout {

    private static final String CIM = "http://iec.ch/TC57/CIM100#";
    private static final double LINE_STUB = 30;
    private static final double OFF_BUS = 9;
    private static final double TWT_OUT = 10;
    private static final double DEVICE_OUT = 3;

    private final Network network;
    private final Map<String, String> terminalNode;
    private final StringBuilder out = new StringBuilder();
    private String diagram;

    private DlLayout(Network network, Map<String, String> terminalNode) {
        this.network = network;
        this.terminalNode = terminalNode;
    }

    /**
     * run writes zip: model's documents (a Diagram Layout among them left out) plus {@code <name>_DL.xml}.
     *
     * @param model a CGMES zip or RDF/XML document
     * @param zip   the zip to write
     * @return the number of diagrams written
     */
    static int run(Path model, Path zip) throws IOException {
        Map<String, byte[]> docs = documents(model);
        docs.values().removeIf(DlLayout::isDiagramLayout);
        Network n = Network.read(model);
        DlLayout dl = new DlLayout(n, terminalNodes(docs.values()));
        int count = dl.write();
        String base = zip.getFileName().toString().replaceFirst("(?i)\\.zip$", "");
        docs.put(base + "_DL.xml", dl.document().getBytes(StandardCharsets.UTF_8));
        try (ZipOutputStream z = new ZipOutputStream(Files.newOutputStream(zip))) {
            for (Map.Entry<String, byte[]> d : docs.entrySet()) {
                z.putNextEntry(new ZipEntry(d.getKey()));
                z.write(d.getValue());
                z.closeEntry();
            }
        }
        return count;
    }

    /** documents returns the .xml/.rdf documents of a zip, or the file itself, by file name. */
    private static Map<String, byte[]> documents(Path model) throws IOException {
        Map<String, byte[]> docs = new LinkedHashMap<>();
        String name = model.getFileName().toString();
        if (!name.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            docs.put(name, Files.readAllBytes(model));
            return docs;
        }
        try (ZipInputStream z = new ZipInputStream(Files.newInputStream(model))) {
            for (ZipEntry e; (e = z.getNextEntry()) != null; ) {
                String entry = Path.of(e.getName()).getFileName().toString();
                String lower = entry.toLowerCase(Locale.ROOT);
                if (!e.isDirectory() && !entry.startsWith(".") && !e.getName().startsWith("__MACOSX/")
                        && (lower.endsWith(".xml") || lower.endsWith(".rdf"))) {
                    docs.put(entry, z.readAllBytes());
                }
            }
        }
        return docs;
    }

    private static boolean isDiagramLayout(byte[] doc) {
        return new String(doc, StandardCharsets.UTF_8).contains("DiagramObject");
    }

    /** terminalNodes maps each Terminal's mRID to its ConnectivityNode's (bare ids, no "#" or "_"). */
    private static Map<String, String> terminalNodes(Iterable<byte[]> docs) throws IOException {
        Map<String, String> m = new HashMap<>();
        XMLInputFactory f = XMLInputFactory.newInstance();
        f.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        for (byte[] doc : docs) {
            try (InputStream in = new ByteArrayInputStream(doc)) {
                XMLStreamReader r = f.createXMLStreamReader(in);
                String terminal = null;
                while (r.hasNext()) {
                    int ev = r.next();
                    if (ev == XMLStreamConstants.START_ELEMENT) {
                        String local = r.getLocalName();
                        if (local.equals("Terminal")) {
                            terminal = bare(about(r));
                        } else if (terminal != null && local.equals("Terminal.ConnectivityNode")) {
                            m.put(terminal, bare(r.getAttributeValue("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "resource")));
                        }
                    } else if (ev == XMLStreamConstants.END_ELEMENT && r.getLocalName().equals("Terminal")) {
                        terminal = null;
                    }
                }
            } catch (XMLStreamException e) {
                throw new IOException(e);
            }
        }
        return m;
    }

    private static String about(XMLStreamReader r) {
        String rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
        String id = r.getAttributeValue(rdf, "ID");
        return id != null ? id : r.getAttributeValue(rdf, "about");
    }

    private static String bare(String id) {
        if (id == null) {
            return null;
        }
        String s = id.startsWith("#") ? id.substring(1) : id;
        s = s.startsWith("urn:uuid:") ? s.substring(9) : s;
        return s.startsWith("_") ? s.substring(1) : s;
    }

    /** write lays out and writes every substation and every voltage level outside one; returns how many. */
    private int write() {
        // Spaced for the SLD editor's symbols (switches 20 high, transformers between the voltage levels), disconnectors
        // in their bays rather than on the busbars.
        SldParameters params = new SldParameters();
        LayoutParameters lp = params.getLayoutParameters()
                .setComponentsOnBusbars(List.of())
                .setMaxComponentHeight(20)
                .setMinSpaceBetweenComponents(20)
                .setVerticalSpaceBus(40)
                .setCellWidth(60)
                .setHorizontalSnakeLinePadding(60)
                .setVoltageLevelPadding(80, 60, 80, 60);
        int count = 0;
        for (Substation s : network.getSubstations()) {
            SubstationGraph g = new NetworkGraphBuilder(network, lp).buildSubstationGraph(s.getId());
            params.getSubstationLayoutFactory().create(g, params.createVoltageLevelLayoutFactory(network)).run(lp);
            emit(g, s.getNameOrId(), g.getVoltageLevels(), g.getMultiTermNodes(), g.getTwtEdges());
            count++;
        }
        for (VoltageLevel vl : network.getVoltageLevels()) {
            if (vl.getSubstation().isEmpty()) {
                VoltageLevelGraph g = new NetworkGraphBuilder(network, lp).buildVoltageLevelGraph(vl.getId());
                params.createVoltageLevelLayoutFactory(network).create(g).run(lp);
                emit(g, vl.getNameOrId(), List.of(g), g.getMultiTermNodes(), g.getTwtEdges());
                count++;
            }
        }
        return count;
    }

    // --- one diagram

    /** A junction of drawn connections: internal nodes, line ends and transformer legs joined by edges. */
    private static final class Junction {
        final Set<String> candidates = new HashSet<>();
        String node;
    }

    private void emit(Graph g, String name, List<VoltageLevelGraph> vls, List<? extends MiddleTwtNode> twts,
                      List<BranchEdge> twtEdges) {
        diagram = newId();
        out.append("  <cim:Diagram rdf:ID=\"_").append(diagram).append("\">\n")
                .append("    <cim:IdentifiedObject.name>").append(xml(name)).append("</cim:IdentifiedObject.name>\n")
                .append("    <cim:Diagram.orientation rdf:resource=\"").append(CIM).append("OrientationKind.negative\"/>\n")
                .append("  </cim:Diagram>\n");

        Map<Node, Point> at = new HashMap<>();
        List<Edge> edges = new ArrayList<>();
        for (VoltageLevelGraph vl : vls) {
            for (Node nd : vl.getNodes()) {
                at.put(nd, g.getShiftedPoint(nd));
            }
            edges.addAll(vl.getEdges());
        }
        for (MiddleTwtNode m : twts) {
            at.put(m, new Point(m.getX(), m.getY()));
        }
        offBusbars(at);

        // Junctions: connected internal nodes, line ends and transformer legs.
        Map<Node, Node> parent = new HashMap<>();
        for (Node nd : at.keySet()) {
            if (isJunction(nd)) {
                parent.put(nd, nd);
            }
        }
        for (Edge e : edges) {
            if (isJunction(e.getNode1()) && isJunction(e.getNode2())) {
                parent.put(find(parent, e.getNode1()), find(parent, e.getNode2()));
            }
        }
        Map<Node, Junction> junction = new HashMap<>();
        for (Node nd : parent.keySet()) {
            junction.computeIfAbsent(find(parent, nd), k -> new Junction());
        }
        // Each junction's node: the one every terminal around it can be on.
        Map<Node, Set<String>> around = new HashMap<>();
        for (Node nd : parent.keySet()) {
            String t = endTerminal(nd);
            if (t != null && terminalNode.get(t) != null) {
                around.computeIfAbsent(find(parent, nd), k -> new HashSet<>()).add("=" + terminalNode.get(t));
            }
        }
        for (Edge e : edges) {
            for (int k = 0; k < 2; k++) {
                Node dev = e.getNodes().get(k);
                Node other = e.getNodes().get(1 - k);
                if (!isJunction(dev) && isJunction(other)) {
                    around.computeIfAbsent(find(parent, other), x -> new HashSet<>()).add(String.join("|", nodesOf(dev)));
                }
            }
        }
        for (Map.Entry<Node, Junction> j : junction.entrySet()) {
            j.getValue().node = common(around.getOrDefault(j.getKey(), Set.of()));
        }

        // Equipment.
        for (Node nd : at.keySet()) {
            Point p = at.get(nd);
            if (nd instanceof BusNode b) {
                object(b.getEquipmentId(), 0, p, new Point(p.getX() + b.getPxWidth(), p.getY()));
                text(b.getEquipmentId(), b.getName(), new Point(p.getX(), p.getY() - 6));
            } else if (nd instanceof SwitchNode s) {
                object(s.getEquipmentId(), s.getOrientation().isHorizontal() ? 90 : 0, p);
            } else if (nd instanceof MiddleTwtNode m) {
                EquipmentNode e = (EquipmentNode) m;
                object(e.getEquipmentId(), 0, p);
                text(e.getEquipmentId(), e.getName(), new Point(p.getX() + 12, p.getY() + 4));
            } else if (nd instanceof FeederNode f && isInjection(f)) {
                object(f.getEquipmentId(), 0, p);
                text(f.getEquipmentId(), f.getName(), new Point(p.getX() + 10, p.getY() + 4));
            } else if (nd instanceof FeederNode f && f.getFeeder().getFeederType() == FeederType.BRANCH) {
                double dir = f.getOrientation() == Orientation.DOWN ? 1 : -1;
                Point end = new Point(p.getX(), p.getY() + dir * LINE_STUB);
                // The polyline runs from terminal 1 to terminal 2: this side's end is on the bay.
                boolean second = f.getFeeder() instanceof FeederWithSides fs && fs.getSide().getIntValue() == 2;
                object(f.getEquipmentId(), 0, second ? new Point[] {end, p} : new Point[] {p, end});
                text(f.getEquipmentId(), f.getName(), new Point(end.getX() + 4, end.getY() + (dir > 0 ? 10 : -4)));
            }
        }

        // Connections.
        for (Edge e : edges) {
            Node a = e.getNode1();
            Node b = e.getNode2();
            Point pa = at.get(a);
            Point pb = at.get(b);
            if (pa == null || pb == null) {
                continue;
            }
            if (a instanceof BusNode) {
                pa = new Point(pb.getX(), pa.getY());
            } else if (b instanceof BusNode) {
                pb = new Point(pa.getX(), pb.getY());
            }
            boolean ja = isJunction(a);
            boolean jb = isJunction(b);
            if (ja && jb) {
                String cn = junction.get(find(parent, a)).node;
                if (cn != null) {
                    object(cn, 0, path(a, pa, b, pb));
                }
            } else if (ja || jb) {
                Node dev = ja ? b : a;
                Node j = ja ? a : b;
                if (dev instanceof BusNode) {
                    String cn = junction.get(find(parent, j)).node;
                    if (cn != null) {
                        object(cn, 0, path(dev, ja ? pb : pa, j, ja ? pa : pb));
                    }
                } else {
                    String t = deviceTerminal(dev, junction.get(find(parent, j)).node);
                    if (t != null) {
                        object(t, 0, outOfDevice(path(dev, ja ? pb : pa, j, ja ? pa : pb)));
                    }
                }
            } else {
                // Two devices side by side: each draws its half; a busbar draws nothing.
                String cn = common(Set.of(String.join("|", nodesOf(a)), String.join("|", nodesOf(b))));
                Point mid = a instanceof BusNode ? pa : b instanceof BusNode ? pb
                        : new Point((pa.getX() + pb.getX()) / 2, (pa.getY() + pb.getY()) / 2);
                if (!(a instanceof BusNode)) {
                    terminalHalf(a, cn, pa, b, mid);
                }
                if (!(b instanceof BusNode)) {
                    terminalHalf(b, cn, pb, a, mid);
                }
            }
        }
        for (BranchEdge e : twtEdges) {
            Node leg = e.getNode1() instanceof MiddleTwtNode ? e.getNode2() : e.getNode1();
            String t = endTerminal(leg);
            List<Point> snake = new ArrayList<>(e.getSnakeLine());
            if (t != null && snake.size() >= 2) {
                // Starting a little out of the transformer's centre, so the line shows which way its terminal faces.
                int c = e.getNode1() instanceof MiddleTwtNode ? 0 : snake.size() - 1;
                Point mid = snake.get(c);
                Point next = snake.get(c == 0 ? 1 : c - 1);
                double len = Math.hypot(next.getX() - mid.getX(), next.getY() - mid.getY());
                if (len > TWT_OUT) {
                    snake.set(c, new Point(mid.getX() + (next.getX() - mid.getX()) * TWT_OUT / len,
                            mid.getY() + (next.getY() - mid.getY()) * TWT_OUT / len));
                }
                object(t, 0, snake.toArray(Point[]::new));
            }
        }
    }

    /**
     * offBusbars moves each switch PowSyBl draws on its busbar a little off it, towards the rest of its bay, so its
     * symbol stands beside the busbar and its busbar terminal is drawn as a short drop onto it.
     */
    private static void offBusbars(Map<Node, Point> at) {
        for (Node nd : at.keySet()) {
            if (!(nd instanceof SwitchNode)) {
                continue;
            }
            Point p = at.get(nd);
            Node bus = nd.getAdjacentNodes().stream().filter(BusNode.class::isInstance).findFirst().orElse(null);
            Node other = nd.getAdjacentNodes().stream().filter(x -> !(x instanceof BusNode)).findFirst().orElse(null);
            if (bus == null || other == null || at.get(bus) == null || at.get(other) == null
                    || Math.abs(at.get(bus).getY() - p.getY()) > 1e-6) {
                continue;
            }
            double dir = Math.signum(at.get(other).getY() - p.getY());
            if (dir != 0) {
                at.put(nd, new Point(p.getX(), p.getY() + dir * OFF_BUS));
            }
        }
    }

    private void terminalHalf(Node dev, String cn, Point p, Node other, Point mid) {
        String t = deviceTerminal(dev, cn);
        if (t != null && (p.getX() != mid.getX() || p.getY() != mid.getY())) {
            object(t, 0, outOfDevice(path(dev, p, other, mid)));
        }
    }

    /** path is an orthogonal polyline from pa to pb, leaving a vertical device vertically (a horizontal one sideways). */
    private static Point[] path(Node a, Point pa, Node b, Point pb) {
        if (pa.getX() == pb.getX() || pa.getY() == pb.getY()) {
            return new Point[] {pa, pb};
        }
        boolean aSideways = a.getOrientation() != null && a.getOrientation().isHorizontal();
        Point bend = aSideways ? new Point(pb.getX(), pa.getY()) : new Point(pa.getX(), pb.getY());
        return new Point[] {pa, bend, pb};
    }

    /**
     * outOfDevice starts a terminal's polyline a little out of its device's centre, towards where it goes, so the
     * drawing shows which side of the device the terminal is on.
     */
    private static Point[] outOfDevice(Point[] path) {
        Point a = path[0];
        Point b = path[1];
        double len = Math.hypot(b.getX() - a.getX(), b.getY() - a.getY());
        if (len > DEVICE_OUT) {
            path[0] = new Point(a.getX() + (b.getX() - a.getX()) * DEVICE_OUT / len, a.getY() + (b.getY() - a.getY()) * DEVICE_OUT / len);
        }
        return path;
    }

    private static Node find(Map<Node, Node> parent, Node n) {
        Node p = parent.get(n);
        if (p == n) {
            return n;
        }
        Node root = find(parent, p);
        parent.put(n, root);
        return root;
    }

    /** isJunction: a node that joins connections without being a device of its own (internal, line end, leg). */
    private static boolean isJunction(Node n) {
        if (n instanceof FeederNode f) {
            return !isInjection(f);
        }
        return !(n instanceof BusNode || n instanceof SwitchNode || n instanceof MiddleTwtNode);
    }

    private static boolean isInjection(FeederNode f) {
        return f.getFeeder().getFeederType() == FeederType.INJECTION;
    }

    /** endTerminal is the CGMES terminal a line end, transformer leg, injection or busbar stands for, or null. */
    private String endTerminal(Node n) {
        if (n instanceof FeederNode f) {
            int side = f.getFeeder() instanceof FeederWithSides fs ? fs.getSide().getIntValue() : 1;
            return terminal(f.getEquipmentId(), side);
        }
        if (n instanceof BusNode b) {
            return terminal(b.getEquipmentId(), 1);
        }
        return null;
    }

    /** nodesOf is the ConnectivityNodes a device's terminals are on, as "=cn" entries. */
    private List<String> nodesOf(Node dev) {
        List<String> out = new ArrayList<>();
        if (dev instanceof SwitchNode s) {
            for (int side = 1; side <= 2; side++) {
                String cn = terminalNode.get(terminal(s.getEquipmentId(), side));
                if (cn != null) {
                    out.add("=" + cn);
                }
            }
        } else {
            String t = endTerminal(dev);
            if (t != null && terminalNode.get(t) != null) {
                out.add("=" + terminalNode.get(t));
            }
        }
        return out;
    }

    /** common is the one node every entry ("=a|=b": a device's possible nodes) allows, or null. */
    private static String common(Set<String> entries) {
        Set<String> all = null;
        for (String entry : entries) {
            Set<String> s = new HashSet<>();
            for (String part : entry.split("\\|")) {
                if (part.startsWith("=")) {
                    s.add(part.substring(1));
                }
            }
            if (s.isEmpty()) {
                continue;
            }
            if (all == null) {
                all = s;
            } else {
                all.retainAll(s);
            }
        }
        return all != null && all.size() == 1 ? all.iterator().next() : null;
    }

    /** deviceTerminal is the terminal of device dev on node cn (an injection's only one when cn is unknown). */
    private String deviceTerminal(Node dev, String cn) {
        if (dev instanceof SwitchNode s) {
            for (int side = 1; side <= 2; side++) {
                String t = terminal(s.getEquipmentId(), side);
                if (t != null && cn != null && cn.equals(terminalNode.get(t))) {
                    return t;
                }
            }
            return null;
        }
        return endTerminal(dev);
    }

    /** terminal is the mRID of terminal side (1, 2, 3) of equipment id, from PowSyBl's CGMES aliases. */
    private String terminal(String id, int side) {
        Identifiable<?> eq = network.getIdentifiable(id);
        if (eq == null) {
            return null;
        }
        for (String alias : eq.getAliases()) {
            if (eq.getAliasType(alias).orElse("").equals("CGMES.Terminal" + side)) {
                return bare(alias);
            }
        }
        return null;
    }

    // --- DL objects

    private void object(String ref, double rotation, Point... pts) {
        String id = newId();
        out.append("  <cim:DiagramObject rdf:ID=\"_").append(id).append("\">\n")
                .append("    <cim:DiagramObject.Diagram rdf:resource=\"#_").append(diagram).append("\"/>\n")
                .append("    <cim:DiagramObject.IdentifiedObject rdf:resource=\"#_").append(ref).append("\"/>\n");
        if (rotation != 0) {
            out.append("    <cim:DiagramObject.rotation>").append(num(rotation)).append("</cim:DiagramObject.rotation>\n");
        }
        out.append("  </cim:DiagramObject>\n");
        points(id, pts);
    }

    private void text(String ref, String text, Point p) {
        if (text == null || text.isEmpty()) {
            return;
        }
        String id = newId();
        out.append("  <cim:TextDiagramObject rdf:ID=\"_").append(id).append("\">\n")
                .append("    <cim:DiagramObject.Diagram rdf:resource=\"#_").append(diagram).append("\"/>\n")
                .append("    <cim:DiagramObject.IdentifiedObject rdf:resource=\"#_").append(ref).append("\"/>\n")
                .append("    <cim:TextDiagramObject.text>").append(xml(text)).append("</cim:TextDiagramObject.text>\n")
                .append("  </cim:TextDiagramObject>\n");
        points(id, p);
    }

    private void points(String object, Point... pts) {
        for (int i = 0; i < pts.length; i++) {
            out.append("  <cim:DiagramObjectPoint rdf:ID=\"_").append(newId()).append("\">\n")
                    .append("    <cim:DiagramObjectPoint.DiagramObject rdf:resource=\"#_").append(object).append("\"/>\n")
                    .append("    <cim:DiagramObjectPoint.sequenceNumber>").append(i + 1).append("</cim:DiagramObjectPoint.sequenceNumber>\n")
                    .append("    <cim:DiagramObjectPoint.xPosition>").append(num(pts[i].getX())).append("</cim:DiagramObjectPoint.xPosition>\n")
                    .append("    <cim:DiagramObjectPoint.yPosition>").append(num(pts[i].getY())).append("</cim:DiagramObjectPoint.yPosition>\n")
                    .append("  </cim:DiagramObjectPoint>\n");
        }
    }

    private String document() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:cim=\"" + CIM + "\""
                + " xmlns:md=\"http://iec.ch/TC57/61970-552/ModelDescription/1#\">\n"
                + "  <md:FullModel rdf:about=\"urn:uuid:" + newId() + "\">\n"
                + "    <md:Model.profile>http://iec.ch/TC57/ns/CIM/DiagramLayout-EU/3.0</md:Model.profile>\n"
                + "    <md:Model.description>PowSyBl single-line layout</md:Model.description>\n"
                + "  </md:FullModel>\n"
                + out
                + "</rdf:RDF>\n";
    }

    private static String newId() {
        return UUID.randomUUID().toString();
    }

    private static String num(double v) {
        return v == Math.rint(v) ? Long.toString((long) v) : Double.toString(v);
    }

    private static String xml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
