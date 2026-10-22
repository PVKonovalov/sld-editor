#!/bin/sh
# Loads a CIM export into a Fuseki dataset for CIMDiagramLayoutEditor.
#   fuseki.sh start <fuseki-dir>   run Fuseki in the foreground with an empty in-memory dataset
#   fuseki.sh load <file.zip|file.xml>...   clear the dataset, then load every RDF/XML file given (zips are unpacked)
#   fuseki.sh add <file.zip|file.xml>...    load without clearing
#   fuseki.sh clear                         empty the dataset
# FUSEKI_URL (default http://localhost:3030) and DATASET (default SmallGrid_DL, the editor's default endpoint) select it.
set -eu

FUSEKI_URL=${FUSEKI_URL:-http://localhost:3030}
DATASET=${DATASET:-SmallGrid_DL}
ENDPOINT="$FUSEKI_URL/$DATASET"

usage() {
	sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//' >&2
	exit 2
}

clear_dataset() {
	curl -fsS -X POST --data-urlencode "update=CLEAR DEFAULT" "$ENDPOINT/update" >/dev/null
	echo "cleared $ENDPOINT"
}

post() {
	printf '%s: ' "$(basename "$1")"
	curl -fsS -X POST -H "Content-Type: application/rdf+xml" --data-binary "@$1" "$ENDPOINT/data?default" |
		sed -n 's/.*"tripleCount" *: *\([0-9]*\).*/\1 triples/p'
}

add() {
	for f in "$@"; do
		case "$f" in
		*.zip)
			tmp=$(mktemp -d)
			unzip -q -o "$f" -d "$tmp"
			find "$tmp" -type f \( -name '*.xml' -o -name '*.rdf' \) | sort | while read -r x; do post "$x"; done
			rm -rf "$tmp"
			;;
		*) post "$f" ;;
		esac
	done
}

[ $# -ge 1 ] || usage
cmd=$1
shift
case "$cmd" in
start)
	[ $# -eq 1 ] || usage
	cd "$1"
	exec ./fuseki-server --mem --update --port "${FUSEKI_URL##*:}" "/$DATASET"
	;;
load)
	[ $# -ge 1 ] || usage
	clear_dataset
	add "$@"
	;;
add)
	[ $# -ge 1 ] || usage
	add "$@"
	;;
clear) clear_dataset ;;
*) usage ;;
esac
