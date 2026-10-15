import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest, FIXTURE_SEED, MAX_FIXTURE_BYTES, POLICY, seededPlayback, seededRandom } from '../fixtures/security/recipes.mjs';
import { getSecurityCase, securityCases, securityFixtureBuffer, securityManifest, writeSecurityFixture } from '../fixtures/security/generate.mjs';

const root = new URL( '../fixtures/security/', import.meta.url );
const sha256 = ( bytes ) => createHash( 'sha256' ).update( bytes ).digest( 'hex' );

// Independent test-only measurements from a native JSON parse, not from the
// production budget scanner. Even rejected fixtures here are tightly bounded;
// they never reach the real terminal/player. Duplicate-key compatibility cases
// are not used as exact-token witnesses because native parsing collapses keys.
function structure( value, parentDepth = 0 ) {
	if ( value === null || typeof value !== 'object' ) return { tokens: 1, containers: 0, depth: parentDepth };
	const depth = parentDepth + 1;
	const result = { tokens: Array.isArray( value ) ? 0 : Object.keys( value ).length, containers: 1, depth };
	for ( const child of Object.values( value ) ) {
		const measured = structure( child, depth );
		result.tokens += measured.tokens;
		result.containers += measured.containers;
		result.depth = Math.max( result.depth, measured.depth );
	}
	return result;
}

function measure( entry, bytes ) {
	const text = bytes.toString( 'utf8' );
	let header;
	let frames;
	const metrics = { bytes: bytes.length, v1Bytes: bytes.length, lineBytes: 0, events: 0, lines: 0, markers: 0, dimension: 0, cells: 0, depth: 0, tokens: 0, containers: 0, lineTokens: 0, timelineMs: 0 };
	if ( entry.format === 1 ) {
		header = JSON.parse( text );
		assert.ok( Array.isArray( header.stdout ) );
		frames = header.stdout.map( ( frame ) => {
			assert.equal( frame.length, 2 );
			return [ frame[ 0 ], 'o', frame[ 1 ] ];
		} );
		Object.assign( metrics, structure( header ) );
	} else {
		const lines = text.split( '\n' );
		if ( text.endsWith( '\n' ) ) lines.pop();
		metrics.lines = lines.length - 1;
		header = JSON.parse( lines[ 0 ] );
		frames = [];
		for ( const [ index, line ] of lines.entries() ) {
			const lineBytes = Buffer.byteLength( line ) + Number( index < lines.length - 1 || text.endsWith( '\n' ) );
			metrics.lineBytes = Math.max( metrics.lineBytes, lineBytes );
			if ( index && ! line.startsWith( '[' ) ) {
				assert.equal( entry.validity, 'upstream-compatible', 'strict-format cases must contain actual events, not ignored padding' );
				continue;
			}
			const value = index ? JSON.parse( line ) : header;
			const parsed = structure( value );
			metrics.depth = Math.max( metrics.depth, parsed.depth );
			metrics.containers = Math.max( metrics.containers, parsed.containers );
			metrics.lineTokens = Math.max( metrics.lineTokens, parsed.tokens );
			if ( index ) frames.push( value );
		}
	}
	assert.equal( header.version, entry.format );
	const dimensions = entry.format === 3 ? [ header.term.cols, header.term.rows ] : [ header.width, header.height ];
	function size( cols, rows ) {
		assert.ok( Number.isSafeInteger( cols ) && cols >= 0 );
		assert.ok( Number.isSafeInteger( rows ) && rows >= 0 );
		metrics.dimension = Math.max( metrics.dimension, cols, rows );
		metrics.cells = Math.max( metrics.cells, ( cols || 80 ) * ( rows || 24 ) );
	}
	size( ...dimensions );
	let time = 0;
	let milliseconds = 0;
	for ( const key of [ 'duration', 'idle_time_limit' ] ) {
		if ( Object.hasOwn( header, key ) ) metrics.timelineMs = Math.max( metrics.timelineMs, header[ key ] * 1000 );
	}
	for ( const frame of frames ) {
		assert.ok( Array.isArray( frame ) );
		assert.equal( frame.length, 3 );
		assert.ok( Number.isFinite( frame[ 0 ] ) && frame[ 0 ] >= 0 );
		assert.equal( typeof frame[ 1 ], 'string' );
		assert.ok( frame[ 1 ].length );
		assert.equal( typeof frame[ 2 ], 'string' );
		if ( entry.format === 2 ) assert.ok( frame[ 0 ] >= time );
		time = entry.format === 2 ? frame[ 0 ] : time + frame[ 0 ];
		assert.ok( Number.isFinite( time ) );
		milliseconds = entry.format === 2 ? frame[ 0 ] * 1000 : milliseconds + frame[ 0 ] * 1000;
		metrics.timelineMs = Math.max( metrics.timelineMs, milliseconds );
		if ( frame[ 1 ] === 'm' ) metrics.markers++;
		if ( frame[ 1 ] === 'r' ) {
			assert.match( frame[ 2 ], /^[1-9][0-9]*x[1-9][0-9]*$/ );
			size( ...frame[ 2 ].split( 'x' ).map( Number ) );
		}
	}
	metrics.events = frames.length;
	return metrics;
}

test( 'golden recipes are deterministic, genuinely seeded, and bounded to known cases', () => {
	assert.equal( FIXTURE_SEED, 0x41c0ffee );
	assert.deepEqual( createManifest(), securityManifest );
	assert.deepEqual( createManifest(), createManifest() );
	assert.deepEqual( seededPlayback(), seededPlayback() );
	const next = seededRandom();
	assert.deepEqual( Array.from( { length: 4 }, () => next().toString( 16 ) ), [ '999f0ef0', '706768d0', '32d9ebae', 'fa29a378' ] );
	assert.throws( () => seededRandom( 0 ), RangeError );
	assert.throws( () => createManifest( 1 ), RangeError );
	assert.throws( () => securityFixtureBuffer( '../../arbitrary' ), RangeError );
	assert.throws( () => securityFixtureBuffer( 'bytes-v2-999999999' ), RangeError );
	assert.equal( new Set( securityCases.map( ( entry ) => entry.id ) ).size, securityCases.length );
} );

test( 'every shared resource purpose retains its exact at/over pair', () => {
	for ( const version of [ 1, 2, 3 ] ) {
		for ( const purpose of [ 'dimensions', 'cells', 'depth', 'events', 'timeline', 'duration', 'idle-limit' ] ) {
			for ( const side of [ 'at', 'over' ] ) {
				const entry = getSecurityCase( `${ purpose }-v${ version }-${ side }` );
				assert.equal( entry.expected.accepted, side === 'at' );
			}
		}
		assert.equal( getSecurityCase( `official-v${ version }` ).safePlayback, true );
		assert.equal( getSecurityCase( `seeded-v${ version }-valid` ).safePlayback, true );
	}
	for ( const purpose of [ 'v1-bytes', 'tokens-v1', 'containers-v1', ...[ 2, 3 ].flatMap( ( version ) => [ 'bytes', 'line', 'line-tokens', 'markers', 'ignored-lines', 'late-resize' ].map( ( kind ) => `${ kind }-v${ version }` ) ) ] ) {
		assert.equal( getSecurityCase( `${ purpose }-at` ).expected.accepted, true );
		assert.equal( getSecurityCase( `${ purpose }-over` ).expected.accepted, false );
	}
	for ( const version of [ 2, 3 ] ) {
		assert.equal( getSecurityCase( `late-resize-v${ version }-dimensions-at` ).expected.accepted, true );
		assert.equal( getSecurityCase( `late-resize-v${ version }-dimensions-over` ).expected.accepted, false );
	}
} );

test( 'timestamp regressions retain independently pinned witnesses and arithmetic', () => {
	assert.equal( POLICY.timelineMs, 2147483647 );
	assert.equal( securityManifest.policy.timelineMs, 2147483647 );
	for ( const version of [ 1, 2, 3 ] ) {
		for ( const purpose of [ 'timeline', 'duration', 'idle-limit' ] ) {
			for ( const [ suffix, value ] of [ [ 'at', 2147483647 ], [ 'over', 2147483648 ] ] ) {
				const entry = getSecurityCase( `${ purpose }-v${ version }-${ suffix }` );
				assert.deepEqual( entry.boundary, { metric: 'timelineMs', limit: 2147483647, value } );
				assert.equal( entry.expected.jsError, suffix === 'over' ? 'time' : null );
			}
		}
		for ( const purpose of [ 'duration', 'idle-limit' ] ) assert.equal( getSecurityCase( `${ purpose }-v${ version }-zero` ).expected.accepted, true );
	}
	for ( const version of [ 1, 3 ] ) {
		for ( const suffix of [ 'at', 'over' ] ) {
			const entry = getSecurityCase( `interval-timeline-v${ version }-${ suffix }` );
			assert.equal( entry.expected.jsError, suffix === 'over' ? 'time' : null );
			const text = securityFixtureBuffer( entry.id ).toString( 'utf8' );
			const frames = version === 1 ? JSON.parse( text ).stdout : text.trimEnd().split( '\n' ).slice( 1 ).map( JSON.parse );
			assert.ok( frames.every( ( frame ) => frame[ 0 ] * 1000 < 2147483647 ), 'no individual interval may mask the cumulative boundary' );
		}
		for ( const [ id, a, b ] of [
			[ 'ms-rounding-over', 307699.2378567164, 1839784.4091432837 ],
			[ 'ms-sum-overflow', 2.996155224770526e303, 1.7677315826146105e305 ],
		] ) {
			const entry = getSecurityCase( `time-v${ version }-${ id }` );
			assert.equal( entry.expected.jsError, 'time' );
			assert.equal( entry.expected.accepted, false );
			assert.ok( entry.bytes < 256, 'arithmetic witnesses must stay tiny' );
			const text = securityFixtureBuffer( entry.id ).toString( 'utf8' );
			const frames = version === 1 ? JSON.parse( text ).stdout : text.trimEnd().split( '\n' ).slice( 1 ).map( JSON.parse );
			assert.deepEqual( frames.map( ( frame ) => frame[ 0 ] ), [ a, b ], 'the exact floating-point witness cannot silently change' );
			assert.ok( Number.isFinite( a * 1000 ) && Number.isFinite( b * 1000 ) && Number.isFinite( ( a + b ) * 1000 ) );
			assert.equal( ( a + b ) * 1000, id === 'ms-rounding-over' ? 2147483647 : 1.7976931348623155e308 );
			assert.equal( a * 1000 + b * 1000, id === 'ms-rounding-over' ? 2147483647.0000002 : Infinity );
		}
	}
	const stalled = getSecurityCase( 'time-v2-output-nonprogress' );
	assert.equal( stalled.expected.jsError, 'time' );
	assert.equal( stalled.expected.accepted, false );
	assert.ok( stalled.bytes < 100 );
	assert.deepEqual( JSON.parse( securityFixtureBuffer( stalled.id ).toString( 'utf8' ).split( '\n' )[ 1 ] ), [ 1e20, 'o', 'x' ] );
	assert.equal( 1e20 * 1000 + 1000 / 60, 1e20 * 1000, 'the real 3.17 batch deadline cannot advance at this magnitude' );
} );

test( 'official native captures retain independently pinned provenance and identical output', () => {
	const provenance = JSON.parse( readFileSync( new URL( 'provenance.json', root ), 'utf8' ) );
	assert.deepEqual( provenance.artifacts.map( ( artifact ) => artifact.file ).sort(), [ 'official-v1.cast', 'official-v2.cast', 'official-v3.cast' ] );
	assert.equal( sha256( readFileSync( new URL( provenance.payload_script, root ) ) ), provenance.payload_script_sha256 );
	assert.equal( sha256( readFileSync( new URL( provenance.reproduction_script, root ) ) ), provenance.reproduction_script_sha256 );
	for ( const artifact of provenance.artifacts ) {
		const bytes = readFileSync( new URL( artifact.file, root ) );
		assert.equal( bytes.length, artifact.bytes );
		assert.equal( sha256( bytes ), artifact.sha256 );
		const text = bytes.toString( 'utf8' );
		const output = artifact.format === 'asciicast-v1' ? JSON.parse( text ).stdout.map( ( frame ) => frame[ 1 ] ).join( '' ) : text.trimEnd().split( '\n' ).slice( 1 ).map( JSON.parse ).filter( ( frame ) => frame[ 1 ] === 'o' ).map( ( frame ) => frame[ 2 ] ).join( '' );
		assert.equal( Buffer.byteLength( output ), provenance.verified.captured_stdout_bytes );
		assert.equal( sha256( output ), provenance.verified.captured_stdout_sha256 );
	}
} );

test( 'seeded recordings preserve equivalent visible output and timing in all formats', () => {
	const comparable = [];
	for ( const version of [ 1, 2, 3 ] ) {
		const text = securityFixtureBuffer( `seeded-v${ version }-valid` ).toString( 'utf8' );
		const frames = version === 1 ? JSON.parse( text ).stdout.map( ( frame ) => [ frame[ 0 ], 'o', frame[ 1 ] ] ) : text.trimEnd().split( '\n' ).slice( 1 ).map( JSON.parse );
		let time = 0;
		comparable.push( frames.map( ( frame ) => { time = version === 2 ? frame[ 0 ] : time + frame[ 0 ]; return [ time, frame[ 2 ] ]; } ) );
		assert.ok( text.includes( 'café 你好 🌱' ), 'fragmented-stream tests need actual multibyte content' );
	}
	assert.deepEqual( comparable[ 0 ], comparable[ 1 ] );
	assert.deepEqual( comparable[ 1 ], comparable[ 2 ] );
} );

for ( const entry of securityCases ) {
	test( `fixture validity and independent boundary measurement: ${ entry.id }`, () => {
		assert.ok( entry.bytes > 0 && entry.bytes <= MAX_FIXTURE_BYTES );
		assert.equal( Boolean( entry.source.file ), ! Boolean( entry.source.segments ) );
		const bytes = securityFixtureBuffer( entry.id );
		assert.equal( bytes.length, entry.bytes );
		assert.equal( sha256( bytes ), entry.sha256 );
		if ( entry.validity === 'intentionally-malformed' ) {
			assert.equal( entry.expected.accepted, false );
			assert.throws( () => measure( entry, bytes ), SyntaxError );
			return;
		}
		const metrics = measure( entry, bytes );
		if ( entry.boundary ) {
			assert.equal( entry.boundary.limit, POLICY[ entry.boundary.metric ] );
			assert.equal( metrics[ entry.boundary.metric ], entry.boundary.value );
			assert.equal( entry.expected.accepted, entry.boundary.value <= entry.boundary.limit );
			// Rejections isolate their named budget. In JSONL the event and line
			// thresholds necessarily coincide for an event-only recording.
			for ( const metric of Object.keys( POLICY ) ) {
				if ( metric === entry.boundary.metric || ( entry.format === 1 ? [ 'lineBytes', 'lineTokens', 'lines' ] : [ 'v1Bytes', 'tokens' ] ).includes( metric ) ) continue;
				if ( entry.boundary.metric === 'events' && metric === 'lines' ) continue;
				assert.ok( metrics[ metric ] <= POLICY[ metric ], `${ metric } must not mask ${ entry.boundary.metric }: ${ metrics[ metric ] }` );
			}
		}
		if ( entry.metrics ) for ( const [ key, value ] of Object.entries( entry.metrics ) ) {
			assert.equal( metrics[ key === 'maximumLineBytes' ? 'lineBytes' : key ], value );
		}
		if ( entry.safePlayback ) {
			assert.equal( entry.expected.accepted, true );
			assert.ok( entry.bytes < 16384 );
			assert.ok( entry.id.startsWith( 'official-' ) || entry.id.startsWith( 'seeded-' ) );
		}
	} );
}

test( 'checked-in cast files stay tiny and temporary materialization refuses overwrites', () => {
	for ( const name of readdirSync( root ).filter( ( file ) => file.endsWith( '.cast' ) ) ) {
		assert.ok( readFileSync( new URL( name, root ) ).length < 16384, `${ name } must not be a committed large payload` );
		assert.ok( securityCases.some( ( entry ) => entry.source.file === name ), `${ name } must have an explicit manifest expectation` );
	}
	const directory = mkdtempSync( join( tmpdir(), 'asciiplayer-fixture-test-' ) );
	try {
		const path = writeSecurityFixture( 'seeded-v2-valid', directory );
		assert.deepEqual( readFileSync( path ), securityFixtureBuffer( 'seeded-v2-valid' ) );
		assert.throws( () => writeSecurityFixture( 'seeded-v2-valid', directory ), { code: 'EEXIST' } );
	} finally { rmSync( directory, { recursive: true, force: true } ); }
} );
