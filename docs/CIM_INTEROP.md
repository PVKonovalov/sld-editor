# Using the CIM export with other tools

The editor exports a diagram as **CGMES 3.0** (a zip with an EQ and a DL profile) and imports CGMES zips or
RDF/XML documents (see the user guide's "CIM export" and "CIM import" sections). This document shows how to move
diagrams between the editor and two other tools:

| Tool | What it does with our files | Direction |
|---|---|---|
| [CGMES DiagramLayout Editor](#cgmes-diagramlayout-editor) ([SOPTIM/CIMDiagramLayoutEditor](https://github.com/SOPTIM/CIMDiagramLayoutEditor)) | Shows and edits the **diagram layout** (DL): the positions we exported, glue points, labels | editor → tool |
| [PowSyBl](#powsybl) through `tools/cim-tools` | Imports the **network** (EQ), checks it, draws its own single-line diagrams; writes CGMES for any network it can read | both ways |

The two tools see different halves of the export. The DiagramLayout Editor draws only the DL, so it shows our layout
but not our symbols. PowSyBl ignores the DL and lays the network out itself, so it shows whether the topology and
equipment are right, not how the sheet looks.

## Exporting from the editor

1. Open the diagram.
2. Click empty canvas so nothing is selected; the Properties panel shows the diagram's Save/Export section.
3. Choose **Export format → CIM, CGMES 3.0 (.zip)** and click **Download**.
4. If the panel lists notes (missing data, guessed voltages, equipment with no CIM class), read them: the same
   problems usually show up in the other tools.

The download is `<name>_CGMES.zip`, containing `<name>_EQ.xml` and `<name>_DL.xml`.

## CGMES DiagramLayout Editor

A Svelte web app that edits CGMES diagram layouts (IEC 61970-453), for CGMES 2.4.15 and 3.0. It does not open files:
it reads and writes a **SPARQL endpoint**, so the export is first loaded into a triple store. Apache Jena Fuseki is the
simplest one.

### What you need

- Java 21 or later (for Fuseki).
- Node.js and npm (for the DiagramLayout Editor).
- A checkout of <https://github.com/SOPTIM/CIMDiagramLayoutEditor>:
  `git clone https://github.com/SOPTIM/CIMDiagramLayoutEditor.git`.
- `tools/cim-tools/fuseki.sh` from this repository (optional; the plain `curl` commands are shown too).

### 1. Install and start Fuseki

Download the binary zip `apache-jena-fuseki-<version>.zip` from <https://jena.apache.org/download/> and unpack it.
Start it with an in-memory, writable dataset named `SmallGrid_DL`, which is the DiagramLayout Editor's default
endpoint, so the editor needs no settings:

```
cd apache-jena-fuseki-<version>
./fuseki-server --mem --update --port 3030 /SmallGrid_DL
```

or, with the helper script:

```
tools/cim-tools/fuseki.sh start /path/to/apache-jena-fuseki-<version>
```

Leave it running. The dataset lives in memory: it is empty after every restart.

### 2. Load the export

Both files go into the **same** dataset, because the DL refers to the equipment in the EQ.

```
tools/cim-tools/fuseki.sh load ~/Downloads/<name>_CGMES.zip
```

`load` empties the dataset first and prints the number of triples per file; `add` loads without emptying (to show
several diagrams side by side). Without the script:

```
unzip <name>_CGMES.zip
for f in <name>_EQ.xml <name>_DL.xml; do
  curl -X POST -H "Content-Type: application/rdf+xml" --data-binary @"$f" \
    "http://localhost:3030/SmallGrid_DL/data?default"
done
```

Fuseki's own web page, <http://localhost:3030>, can do the same: choose the dataset, open its upload page, keep the
graph as *default*, add both files and upload.

### 3. Show the diagram

```
cd CIMDiagramLayoutEditor
npm install          # once
npx vite --port 5185 # or `npm run dev`, but its default port 5173 is also the SLD editor's dev port
```

Open <http://localhost:5185>, then:

1. **SPARQL Endpoint URL** is `http://localhost:3030/SmallGrid_DL` already; set **CGMES Version** to **3.0**.
2. Click **Load diagram profiles**; the diagram appears under **Select diagram** by its name.
3. Click **Render diagram**. The status line reports the number of objects and points read.
4. The view opens zoomed into the top-left corner (its fit-to-view stops at scale 1, and our coordinates are large).
   Zoom out with the mouse wheel (Shift+wheel for bigger steps) and pan by dragging; the minimap shows where you are.
5. Tick **Show Glue Connections** to see the glue points: the junctions where our wires meet terminals and busbars.

What you see: busbars, wires and lines as polylines in our positions, every device as a single point (a DL object
for a device is its position plus a style name, which this tool does not draw), and the labels with their text.

### 4. Loading another diagram or a new export

`fuseki.sh load` empties the dataset first, which is what you want after re-exporting a diagram you have changed
(otherwise the items you deleted stay in the store). Then click **Load diagram profiles** again. To empty it by hand:

```
tools/cim-tools/fuseki.sh clear
# or
curl -X POST --data-urlencode "update=CLEAR DEFAULT" http://localhost:3030/SmallGrid_DL/update
```

### Edits made there

The DiagramLayout Editor writes its edits back to Fuseki, not to a file. Fuseki can hand the dataset back as RDF/XML:

```
curl -H "Accept: application/rdf+xml" "http://localhost:3030/SmallGrid_DL/data?default" -o edited.xml
```

**This file cannot be imported into the SLD editor yet**: Fuseki writes every object as a generic
`rdf:Description` with an `rdf:type`, and absolute identifiers based on the upload address, while our CIM import reads
the CGMES style (`<cim:Breaker rdf:ID="_…">`). The import answers "no equipment to draw in the CIM documents".
Use the DiagramLayout Editor to view and check layouts, and make changes in the SLD editor.

### Troubleshooting

| Symptom | Cause |
|---|---|
| "Load diagram profiles" finds nothing | The files went into another dataset or a named graph; load them into the default graph of `SmallGrid_DL`, or change the endpoint URL in the editor. |
| Diagram list fine, render empty | CGMES Version is set to 2.4.15; our export is 3.0. |
| Only the top-left corner is visible | Expected; zoom out with the wheel. |
| Deleted items still shown | The dataset was not emptied before loading the new export (`fuseki.sh load` does it). |

## PowSyBl

[PowSyBl](https://github.com/powsybl/powsybl-core) is an open-source power system library (Java) with a complete CGMES importer and
exporter and its own single-line diagram renderer. `tools/cim-tools` is a small command-line example built on it:

| Command | What it does |
|---|---|
| `check [-v] <model>...` | Imports each model and prints what PowSyBl built (substations, voltage levels, switches, transformers, …) and the import warnings and errors (`-v`: the whole import report). Exit status 1 if any import failed. |
| `render <model> <dir>` | Draws one SVG per substation (and per voltage level outside a substation) with PowSyBl's own layout. |
| `to-cgmes <model> <out.zip>` | Writes any model PowSyBl can read as a CGMES 3.0 zip (EQ, TP, SSH, SV) for the SLD editor's import. Instead of a file, `ieee9`, `ieee14`, `ieee30`, `ieee57`, `ieee118` or `ieee300` writes PowSyBl's built-in IEEE test network. |
| `layout <model> <out.zip>` | A developer reference: the model's documents plus a Diagram Layout of PowSyBl's own single-line layout, a diagram per substation named after it, spaced for the editor's symbols. Importing it shows PowSyBl's layout drawn with our symbols, to compare with the editor's own automatic layout of the same model. |

A *model* is any file PowSyBl imports: a CGMES zip (such as our export), XIIDM, IEEE CDF (`.txt`) or MATPOWER
(`.mat`).

### Build

Only Java 21 or later is needed: the project carries a Maven wrapper, which downloads Maven 3.9.9 on its first run.

```
cd tools/cim-tools
./mvnw package          # Windows: mvnw.cmd package
```

An installed Maven 3.9 (`mvn package`) works too. The build downloads PowSyBl 7.4.0 and powsybl-single-line-diagram
5.6.0 from Maven Central and writes one runnable jar,
`target/cim-tools.jar` (about 40 MB). Logging goes to stderr; add `2>/dev/null` to see only the results.

### Check an export

```
java -jar target/cim-tools.jar check ~/Downloads/<name>_CGMES.zip
```

Example output for a two-transformer substation:

```
=== <name>_CGMES.zip
  substations 6, voltage levels 6, busbars 4, switches 26 (open 6), lines 0,
  transformers 2W 4 / 3W 0, generators 0, loads 12, shunts 0, SVCs 0, buses 4
  no import warnings
```

Compare the counts with the diagram: switches, transformers and loads should match what you drew. Common findings:

- **Import fails with a voltage error**: a voltage class is still named after its colour and the colour has no preset
  voltage in `voltage_colors`. Name the class after its voltage (e.g. "35 kV") or add the preset.
- **A 4-winding transformer**: PowSyBl supports 2 and 3 windings only; our export notes it.
- **More substations than expected**: equipment that is not connected to the rest (a wire missing, a switch drawn
  next to a bus instead of on it) becomes a substation of its own, because substations follow the connections.
- **A file made by another tool won't import** (`render`, `layout` and `to-cgmes` stop with
  `cim-tools: cannot import <file>: <reason>` and exit code 1; `check` lists it as FAILED): the file breaks a rule
  PowSyBl relies on. Typical reasons: a substation without `Substation.Region` (then none of its voltage levels is
  created: "voltage level … has not been created in IIDM"), an `rdf:ID` starting with a digit (not an XML name), a
  busbar section with several terminals (CIM allows one: "already contains an object 'BusbarSectionImpl'"). Fix the
  file at its source; `check -v` prints PowSyBl's whole import report.

### Draw an export with PowSyBl's renderer

```
java -jar target/cim-tools.jar render ~/Downloads/<name>_CGMES.zip out/
```

It prints each SVG it writes (`out/00_<substation>.svg`, …); open them in a browser. These drawings are PowSyBl's own
layout of the network; they show that switches, transformers and feeders are connected as in the diagram, not how
the diagram looks.

### Compare the editor's automatic layout with PowSyBl's

The editor lays out a model without a diagram layout itself (one executable, no Java). To see PowSyBl's layout of the
same model drawn with the editor's symbols, write it as a diagram layout and import that:

```
java -jar target/cim-tools.jar layout <model> <name>_layout.zip     # → File → Import
```

`render` shows the same layout with PowSyBl's own symbols.

### Bring a PowSyBl network into the editor

```
java -jar target/cim-tools.jar to-cgmes ieee14 ieee14.zip
java -jar target/cim-tools.jar to-cgmes my-network.xiidm my-network.zip
```

Then in the SLD editor: **File → Import**, choose the zip. PowSyBl writes no diagram layout, so the import lays each
substation out automatically on the model of PowSyBl's own layout (each voltage level's parallel busbars as stacked
rows, each bay a column dropping onto them, high voltage at the top, transformers between the levels), one page per
substation saved in a folder named after the file, and says so in the import log. A bus-branch model such as the IEEE networks has buses instead of
busbars and switches, so each page is small: the bus, its injections, and the lines and transformers leaving it.

A CGMES file from another tool can be imported the same way, directly; `to-cgmes` is only needed for other formats.

## Quick reference

```
# Fuseki + DiagramLayout Editor
tools/cim-tools/fuseki.sh start <fuseki-dir>        # terminal 1
npx vite --port 5185                                # terminal 2, in CIMDiagramLayoutEditor
tools/cim-tools/fuseki.sh load <name>_CGMES.zip     # then Load diagram profiles → Render diagram

# PowSyBl
(cd tools/cim-tools && ./mvnw package)              # once
java -jar tools/cim-tools/target/cim-tools.jar check  <name>_CGMES.zip
java -jar tools/cim-tools/target/cim-tools.jar render <name>_CGMES.zip out/
java -jar tools/cim-tools/target/cim-tools.jar layout <model> <name>_layout.zip  # PowSyBl's layout → File → Import
java -jar tools/cim-tools/target/cim-tools.jar to-cgmes ieee14 ieee14.zip   # → File → Import
```
