/** TEST ONLY. Fixed, bounded recipes; never accepts attacker-selected sizes. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FIXTURE_SEED = 0x41c0ffee;
export const MAX_FIXTURE_BYTES = 32 * 1024 * 1024 + 1;
export const POLICY = Object.freeze( {
	bytes: 33554432, v1Bytes: 2097152, lineBytes: 262144, events: 100000,
	lines: 100000, markers: 1000, dimension: 1000, cells: 40000,
	depth: 15, containers: 100016, tokens: 400000, lineTokens: 20000,
	timelineMs: 2147483647,
} );

// This PRNG is part of the reproducibility contract, not a security primitive.
export function seededRandom( seed = FIXTURE_SEED ) {
	if ( seed !== FIXTURE_SEED ) throw new RangeError( 'Only the documented fixture seed is supported.' );
	let state = seed;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return state >>> 0;
	};
}

const segment = ( text, repeat = 1 ) => ( { text, repeat } );
const json = JSON.stringify;
const byteLength = ( text ) => Buffer.byteLength( text, 'utf8' );
const partsBytes = ( parts ) => parts.reduce( ( sum, part ) => sum + byteLength( part.text ) * part.repeat, 0 );
const officialText = Object.fromEntries( [ 1, 2, 3 ].map( ( version ) => [ version, readFileSync( new URL( `official-v${ version }.cast`, import.meta.url ), 'utf8' ) ] ) );
const officialData = Object.fromEntries( [ 1, 2, 3 ].map( ( version ) => [ version, version === 1 ? JSON.parse( officialText[ version ] ) : officialText[ version ].trimEnd().split( '\n' ).map( JSON.parse ) ] ) );
const officialHeader = ( version ) => version === 1 ? officialData[ version ] : officialData[ version ][ 0 ];
const officialOutput = ( version ) => version === 1 ? officialData[ version ].stdout.map( ( frame ) => frame[ 1 ] ).join( '' ) : officialData[ version ].slice( 1 ).filter( ( frame ) => frame[ 1 ] === 'o' ).map( ( frame ) => frame[ 2 ] ).join( '' );
// Normalize only the envelope: discard wall clock, PTY timing and optional
// capture metadata; retain the officially recorded format and dimensions.
const header = ( version, cols, rows ) => {
	const recorded = officialHeader( version );
	if ( recorded.version !== version ) throw new Error( 'Official capture format mismatch.' );
	return version === 3
		? { version: recorded.version, term: { cols: cols ?? recorded.term.cols, rows: rows ?? recorded.term.rows } }
		: { version: recorded.version, width: cols ?? recorded.width, height: rows ?? recorded.height };
};
const headerText = ( version, cols = 80, rows = 24 ) => json( header( version, cols, rows ) );
const simpleCast = ( version, cols = 80, rows = 24 ) => version === 1
	? json( { ...header( version, cols, rows ), stdout: [ [ 0, 'PR41 bounded control\r\n' ] ] } ) + '\n'
	: headerText( version, cols, rows ) + '\n[0,"o","PR41 bounded control\\r\\n"]\n';

/** Identical output and absolute instants; v1/v3 serialize interval timestamps. */
export function seededPlayback( seed = FIXTURE_SEED ) {
	const next = seededRandom( seed );
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const word = ( length ) => Array.from( { length }, () => alphabet[ next() % alphabet.length ] ).join( '' );
	const startText = 'PR41 START seed 41c0ffee';
	const seekText = 'PR41 SEEK seed 41c0ffee';
	const at = [ 0, 1 + ( next() % 8 ) / 4, 8, 12 ];
	const recordedOutput = officialOutput( 1 );
	if ( recordedOutput !== officialOutput( 2 ) || recordedOutput !== officialOutput( 3 ) ) throw new Error( 'Official captured output differs across formats.' );
	const output = [ startText + '\r\n', recordedOutput + 'seeded ' + word( 24 ) + ' café 你好 🌱\r\n', seekText + '\r\n', 'PR41 END\r\n' ];
	return { at, output, title: 'Seeded control ' + word( 8 ), playback: { startText, seekText, seekPercent: 80, cols: 80, rows: 24, duration: 12 } };
}

export function createRecipes( seed = FIXTURE_SEED ) {
	const next = seededRandom( seed );
	const controls = seededPlayback( seed );
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const bytePayload = Array.from( { length: 1013 }, () => alphabet[ next() % alphabet.length ] ).join( '' );
	const cases = [];
	function add( id, format, description, parts, { error = null, boundary, small = false, category = 'resource-boundary', predecode, playback, metrics, safePlayback = false, provenance = 'normalized-mutation' } = {} ) {
		const bytes = partsBytes( parts );
		if ( bytes > MAX_FIXTURE_BYTES ) throw new RangeError( `Unbounded recipe: ${ id }` );
		const hash = createHash( 'sha256' );
		// Hash each recipe without constructing a potentially 32 MiB string.
		for ( const part of parts ) {
			const chunkRepeats = Math.max( 1, Math.floor( 65536 / byteLength( part.text ) ) );
			let remaining = part.repeat;
			while ( remaining ) {
				const count = Math.min( remaining, chunkRepeats );
				hash.update( part.text.repeat( count ), 'utf8' );
				remaining -= count;
			}
		}
		const entry = {
			id, format, description, category, provenance, safePlayback,
			validity: category === 'malformed' ? 'intentionally-malformed' : category === 'upstream-compatibility' ? 'upstream-compatible' : 'format-valid',
			source: small ? { file: `${ id }.cast` } : { segments: parts },
			expected: { accepted: error === null, jsError: error }, bytes, sha256: hash.digest( 'hex' ),
		};
		if ( boundary ) entry.boundary = boundary;
		if ( predecode !== undefined ) entry.expected.noDecodeAtOrAboveBytes = predecode === 'document' ? bytes - 1 : predecode;
		if ( playback ) entry.playback = playback;
		if ( metrics ) entry.metrics = metrics;
		cases.push( { entry, parts } );
	}
	const pair = ( metric, limit, value ) => ( { metric, limit, value } );
	for ( const version of [ 1, 2, 3 ] ) {
		add( `official-v${ version }`, version, 'Unmodified native capture from the pinned official asciinema recorder; original PTY timings are intentionally retained.', [ segment( officialText[ version ] ) ], { small: true, category: 'valid-control', safePlayback: true, provenance: 'official-raw-capture' } );
		const frames = controls.output.map( ( output, index ) => [ version === 2 ? controls.at[ index ] : controls.at[ index ] - ( controls.at[ index - 1 ] || 0 ), ...( version === 1 ? [] : [ 'o' ] ), output ] );
		const meta = { ...header( version ), title: controls.title, duration: 12 };
		const content = version === 1 ? json( { ...meta, stdout: frames }, null, 2 ) + '\n' : [ meta, ...frames ].map( json ).join( '\n' ) + '\n';
		add( `seeded-v${ version }-valid`, version, 'Official captured output plus fixed-seed text; normalized equivalent absolute times across all formats.', [ segment( content ) ], { small: true, category: 'valid-control', playback: controls.playback, safePlayback: true } );
		add( `valid-v${ version }-zero`, version, 'Zero header dimensions retain upstream 80 by 24 defaults.', [ segment( simpleCast( version, 0, 0 ) ) ], { small: true, category: 'upstream-compatibility' } );
		add( `dimensions-v${ version }-at`, version, 'The inclusive per-axis cap still fits within the independent cell budget.', [ segment( simpleCast( version, 1000, 24 ) ) ], { small: true, boundary: pair( 'dimension', POLICY.dimension, 1000 ) } );
		add( `dimensions-v${ version }-over`, version, 'Syntactically valid header requests an axis one beyond the dimension cap.', [ segment( simpleCast( version, 1001, 24 ) ) ], { small: true, error: 'dimensions', boundary: pair( 'dimension', POLICY.dimension, 1001 ) } );
		for ( const over of [ false, true ] ) {
			const suffix = over ? 'over' : 'at';
			const cols = over ? 201 : 200;
			add( `cells-v${ version }-${ suffix }`, version, 'Each axis is valid; their product alone selects the cell boundary.', [ segment( simpleCast( version, cols, 200 ) ) ], { small: true, error: over ? 'cells' : null, boundary: pair( 'cells', POLICY.cells, cols * 200 ) } );
			const depth = POLICY.depth + Number( over );
			const prefix = version === 1 ? '{"version":1,"width":80,"height":24,"stdout":[],"metadata":' : headerText( version ).slice( 0, -1 ) + ',"metadata":';
			add( `depth-v${ version }-${ suffix }`, version, 'Unknown metadata reaches the lexical container-depth boundary before JSON allocation.', [ segment( prefix + '['.repeat( depth - 1 ) + '0' + ']'.repeat( depth - 1 ) + '}\n' ) ], { small: true, error: over ? 'complexity' : null, boundary: pair( 'depth', POLICY.depth, depth ), predecode: over ? 'document' : undefined } );
			const count = POLICY.events + Number( over );
			const parts = version === 1
				? [ segment( '{"version":1,"width":80,"height":24,"stdout":[' ), segment( '[0,""],', count - 1 ), segment( '[0,""]]}\n' ) ]
				: [ segment( headerText( version ) + '\n' ), segment( '[0,"o",""]\n', count ) ];
			add( `events-v${ version }-${ suffix }`, version, version === 1 ? 'Full default v1 event boundary without first exhausting scalar/container budgets.' : 'Event and physical-line caps coincide for output-only JSONL.', parts, { error: over ? 'events' : null, boundary: pair( 'events', POLICY.events, count ), metrics: { events: count, ...( version === 1 ? { containers: count + 2 } : {} ) } } );
		}
	}

	// Tiny time witnesses use a pinned policy independent of production constants.
	// Keep official captures untouched and never mark these as browser-playable.
	const timedCast = ( version, timestamps, metadata = {} ) => {
		const meta = { ...header( version ), ...metadata };
		const frames = timestamps.map( ( time, index ) => [ time, ...( version === 1 ? [] : [ 'o' ] ), index ? 'end' : 'x' ] );
		return ( version === 1 ? json( { ...meta, stdout: frames } ) : [ meta, ...frames ].map( json ).join( '\n' ) ) + '\n';
	};
	for ( const version of [ 1, 2, 3 ] ) {
		for ( const over of [ false, true ] ) {
			const suffix = over ? 'over' : 'at';
			const seconds = over ? 2147483.648 : 2147483.647;
			const options = { small: true, error: over ? 'time' : null, boundary: pair( 'timelineMs', 2147483647, over ? 2147483648 : 2147483647 ) };
			add( `timeline-v${ version }-${ suffix }`, version, 'One event isolates the inclusive 2^31 - 1 millisecond timeline horizon.', [ segment( timedCast( version, [ seconds ] ) ) ], options );
			for ( const [ id, key ] of [ [ 'duration', 'duration' ], [ 'idle-limit', 'idle_time_limit' ] ] ) {
				add( `${ id }-v${ version }-${ suffix }`, version, 'Timing metadata uses the same finite nonnegative millisecond horizon even when upstream ignores that field.', [ segment( timedCast( version, [ 0 ], { [ key ]: seconds } ) ) ], options );
			}
		}
		for ( const [ id, key ] of [ [ 'duration', 'duration' ], [ 'idle-limit', 'idle_time_limit' ] ] ) {
			add( `${ id }-v${ version }-zero`, version, 'Zero remains valid for optional timing metadata.', [ segment( timedCast( version, [ 0 ], { [ key ]: 0 } ) ) ], { small: true, category: 'valid-control' } );
		}
	}
	for ( const version of [ 1, 3 ] ) {
		for ( const over of [ false, true ] ) {
			add( `interval-timeline-v${ version }-${ over ? 'over' : 'at' }`, version, 'Each interval is inside the horizon; only their upstream-order millisecond sum selects the boundary.', [ segment( timedCast( version, [ 1073741.823, over ? 1073741.825 : 1073741.824 ] ) ) ], { small: true, error: over ? 'time' : null, boundary: pair( 'timelineMs', 2147483647, over ? 2147483648 : 2147483647 ) } );
		}
		add( `time-v${ version }-ms-rounding-over`, version, 'Adding seconds before conversion rounds to the allowed cap, but summing each interval in milliseconds exceeds it.', [ segment( timedCast( version, [ 307699.2378567164, 1839784.4091432837 ] ) ) ], { small: true, error: 'time', boundary: pair( 'timelineMs', 2147483647, 2147483647.0000002 ) } );
		add( `time-v${ version }-ms-sum-overflow`, version, 'Both converted intervals and the converted seconds sum are finite, but upstream interval-by-interval millisecond addition overflows.', [ segment( timedCast( version, [ 2.996155224770526e303, 1.7677315826146105e305 ] ) ) ], { small: true, error: 'time' } );
	}
	add( 'time-v2-output-nonprogress', 2, 'A tiny finite timestamp makes the upstream output batching deadline equal its start, so callbacks repeat without consuming output.', [ segment( timedCast( 2, [ 1e20 ] ) ) ], { small: true, error: 'time' } );

	add( 'valid-v1-multiline-late-version', 1, 'Pretty v1 document places its version after stdout and nested metadata.', [ segment( '{\n  "stdout": [[0,"multiline v1\\r\\n"]],\n  "metadata": {"version": 3},\n  "width": 80,\n  "height": 24,\n  "version": 1\n}\n' ) ], { small: true, category: 'valid-control' } );
	add( 'valid-v1-escaped-version', 1, 'Escaped top-level version key is still v1.', [ segment( '{"ver\\u0073ion":1,"width":80,"height":24,"stdout":[]}\n' ) ], { small: true, category: 'valid-control' } );
	add( 'valid-v1-duplicate-version', 1, 'Last duplicate version wins under the bundled JSON parsers.', [ segment( '{"version":2,"version":1,"width":80,"height":24,"stdout":[]}\n' ) ], { small: true, category: 'upstream-compatibility' } );
	add( 'malformed-v1-json', 1, 'Deliberately missing the stdout array closer.', [ segment( '{"version":1,"width":80,"height":24,"stdout":[}\n' ) ], { small: true, category: 'malformed', error: 'invalid' } );

	for ( const version of [ 2, 3 ] ) {
		const head = headerText( version ) + '\n';
		add( `valid-v${ version }-filtered-lines`, version, 'Blank/comment/indented non-event lines follow upstream filtering, not strict canonical JSONL.', [ segment( head + '\n# compatibility comment\nignored text\n [999,"o","ignored"]\n[0,"o","accepted output\\r\\n"]\n' ) ], { small: true, category: 'upstream-compatibility' } );
		add( `late-resize-v${ version }-at`, version, 'Ordinary output precedes an inclusive 40,000-cell late resize.', [ segment( head + '[0,"o","safe prefix\\r\\n"]\n[12,"r","200x200"]\n' ) ], { small: true, boundary: pair( 'cells', POLICY.cells, 40000 ) } );
		add( `late-resize-v${ version }-over`, version, 'Ordinary output precedes a late resize with valid axes but excessive cells.', [ segment( head + '[0,"o","safe prefix\\r\\n"]\n[12,"r","201x200"]\n' ) ], { small: true, error: 'cells', boundary: pair( 'cells', POLICY.cells, 40200 ) } );
		add( `late-resize-v${ version }-dimensions-at`, version, 'Ordinary output precedes an inclusive 1,000-column late resize.', [ segment( head + '[0,"o","safe prefix\\r\\n"]\n[12,"r","1000x24"]\n' ) ], { small: true, boundary: pair( 'dimension', POLICY.dimension, 1000 ) } );
		add( `late-resize-v${ version }-dimensions-over`, version, 'Ordinary output precedes a late resize exceeding the per-axis dimension cap.', [ segment( head + '[0,"o","safe prefix\\r\\n"]\n[12,"r","1001x24"]\n' ) ], { small: true, error: 'dimensions', boundary: pair( 'dimension', POLICY.dimension, 1001 ) } );
		add( `malformed-v${ version }-event`, version, 'Deliberately invalid JSON event after a valid header.', [ segment( head + '[0,"o",broken]\n' ) ], { small: true, category: 'malformed', error: 'invalid' } );
		for ( const over of [ false, true ] ) {
			const suffix = over ? 'over' : 'at';
			const markerCount = POLICY.markers + Number( over );
			add( `markers-v${ version }-${ suffix }`, version, 'Marker count boundary; bytes, line count and dimensions remain small.', [ segment( head ), segment( '[0,"m","mark"]\n', markerCount ) ], { error: over ? 'markers' : null, boundary: pair( 'markers', POLICY.markers, markerCount ) } );
			const lineBytes = POLICY.lineBytes + Number( over );
			const eventPrefix = '[0,"o","';
			const eventSuffix = '"]\n';
			add( `line-v${ version }-${ suffix }`, version, 'One syntactically valid output event at the UTF-8 line-byte boundary, including LF.', [ segment( head + eventPrefix ), segment( 'x', lineBytes - byteLength( eventPrefix + eventSuffix ) ), segment( eventSuffix ) ], { error: over ? 'line' : null, boundary: pair( 'lineBytes', POLICY.lineBytes, lineBytes ), predecode: over ? lineBytes - 1 : undefined } );
			const totalBytes = POLICY.bytes + Number( over );
			const block = eventPrefix + bytePayload + eventSuffix;
			let blocks = Math.floor( ( totalBytes - byteLength( head ) ) / 1024 );
			let tailBytes = totalBytes - byteLength( head ) - blocks * 1024;
			if ( tailBytes < byteLength( eventPrefix + eventSuffix ) ) { blocks--; tailBytes += 1024; }
			add( `bytes-v${ version }-${ suffix }`, version, 'Full 32 MiB body boundary using valid output events; no padding comments or oversized line.', [ segment( head ), segment( block, blocks ), segment( eventPrefix ), segment( 'x', tailBytes - byteLength( eventPrefix + eventSuffix ) ), segment( eventSuffix ) ], { error: over ? 'bytes' : null, boundary: pair( 'bytes', POLICY.bytes, totalBytes ), predecode: over ? 'document' : undefined, metrics: { events: blocks + 1, maximumLineBytes: 1024 } } );
			if ( over ) cases.at( -1 ).entry.expected.phpNoDecodeAtOrAboveBytes = 1;
			const tokenCount = POLICY.lineTokens + Number( over );
			const scalarCount = tokenCount - ( version === 2 ? 7 : 8 );
			const parts = [ segment( headerText( version ).slice( 0, -1 ) + ',"metadata":[' ), segment( '0,', scalarCount - 1 ), segment( '0]}\n' ) ];
			add( `line-tokens-v${ version }-${ suffix }`, version, 'Wide metadata uses the strict per-line scalar/key token cap, never the legacy v1 cap.', parts, { error: over ? 'complexity' : null, boundary: pair( 'lineTokens', POLICY.lineTokens, tokenCount ), predecode: over ? 'document' : undefined } );
			const lines = POLICY.lines + Number( over );
			add( `ignored-lines-v${ version }-${ suffix }`, version, 'One valid output event plus ignored blank lines isolates the physical JSONL processing budget.', [ segment( head + '[0,"o","line budget control\\r\\n"]\n' ), segment( '\n', lines - 1 ) ], { category: 'upstream-compatibility', error: over ? 'events' : null, boundary: pair( 'lines', POLICY.lines, lines ), metrics: { events: 1 } } );
		}
	}

	for ( const over of [ false, true ] ) {
		const suffix = over ? 'over' : 'at';
		const bytes = POLICY.v1Bytes + Number( over );
		const prefix = '{\n"version":1,"width":80,"height":24,"stdout":[[0,"';
		const end = '"]]}\n';
		add( `v1-bytes-${ suffix }`, 1, 'Legacy multiline document has its own 2 MiB budget, distinct from JSONL limits.', [ segment( prefix ), segment( 'x', bytes - byteLength( prefix + end ) ), segment( end ) ], { error: over ? 'bytes' : null, boundary: pair( 'v1Bytes', POLICY.v1Bytes, bytes ), predecode: over ? 'document' : undefined } );
		const prefixMetadata = '{\n"version":1,"width":80,"height":24,"stdout":[],"metadata":[';
		const tokenCount = POLICY.tokens + Number( over );
		const scalarCount = tokenCount - 8;
		add( `tokens-v1-${ suffix }`, 1, 'Unknown scalar metadata reaches the complete v1 scalar/key allocation budget.', [ segment( prefixMetadata ), segment( '0,', scalarCount - 1 ), segment( '0]}\n' ) ], { error: over ? 'complexity' : null, boundary: pair( 'tokens', POLICY.tokens, tokenCount ), predecode: over ? 'document' : undefined } );
		const containers = POLICY.containers + Number( over );
		add( `containers-v1-${ suffix }`, 1, 'Empty metadata objects isolate the container budget from scalar and event budgets.', [ segment( prefixMetadata ), segment( '{},', containers - 4 ), segment( '{}]}\n' ) ], { error: over ? 'complexity' : null, boundary: pair( 'containers', POLICY.containers, containers ), predecode: over ? 'document' : undefined } );
	}
	add( 'valid-v1-long-first-line', 1, 'Version appears after a first line larger than the JSONL cap; v1 discrimination must preserve it.', [ segment( '{"title":"' ), segment( 'x', POLICY.lineBytes ), segment( '",\n"version":1,"width":80,"height":24,"stdout":[[0,"late version\\r\\n"]]}\n' ) ], { category: 'valid-control' } );
	add( 'invalid-v2-duplicate-version-wide', 2, 'Last duplicate version is v2; wide metadata must not obtain a v1 allocation budget.', [ segment( '{"version":1,"version":2,"width":80,"height":24,"metadata":[' ), segment( '0,', POLICY.lineTokens ), segment( '0]}\n' ) ], { category: 'upstream-compatibility', error: 'complexity', predecode: 'document' } );
	return cases;
}

export function createManifest( seed = FIXTURE_SEED ) {
	return {
		schemaVersion: 1,
		seed: '0x41c0ffee',
		generator: 'xorshift32-v1; fixed case IDs and fixed resource policies',
		policy: POLICY,
		cases: createRecipes( seed ).map( ( item ) => item.entry ),
	};
}
