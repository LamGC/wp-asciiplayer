<?php
/** Test-only decoder instrumentation, loaded before production calls. */

namespace LamGC\Asciiplayer {
	// Instrument the real decoder without adding a production test hook. A gate
	// failure must not build the rejected whole-document object graph.
	function json_decode( $json, $associative = null, $depth = 512, $flags = 0 ) {
		$GLOBALS['cast_decode_lengths'][] = strlen( $json );
		return \json_decode( $json, $associative, $depth, $flags );
	}
}
