"""A six-page synthetic deck for the grounded-quiz tests.

Six pages so boilerplate detection runs (it needs >= 4 pages); the
"University of Marburg" footer sits on 5 of 6 pages (>= 60%) and is stripped.
Lines differ by letters, never only by digits, because normalize_line folds
digit runs to '#'."""

GRAPH_DECK_PAGES = [
    "Graph Theory\nIntroduction lecture",
    "Vertices and Edges\nA graph consists of vertices connected by edges.\nAn edge joins exactly two vertices.\nUniversity of Marburg",
    "Dijkstra Algorithm\nDijkstra computes shortest paths from a single source.\nIt requires non-negative edge weights.\nUniversity of Marburg",
    "Spanning Trees\nKruskal builds a minimum spanning tree by adding the cheapest edge.\nPrim grows the tree from a start vertex.\nUniversity of Marburg",
    "Graph Coloring\nThe four color theorem states that 4 colors suffice for planar maps.\nUniversity of Marburg",
    "Zusammenfassung\nGraphen modellieren paarweise Beziehungen zwischen Knoten.\nUniversity of Marburg",
]
