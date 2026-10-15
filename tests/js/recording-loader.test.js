import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRecording, DEFAULT_LIMITS, RecordingLoadError, validateInitialDimensions } from '../../src/recording-loader.js';
import { normalizePlayerOptions } from '../../src/options.js';

const encode = ( text ) => new TextEncoder().encode( text );
const h2 = { version: 2, width: 80, height: 24 };
const h3 = { version: 3, term: { cols: 80, rows: 24 } };
const cast = ( header = h2, events = [ [ 0, 'o', 'hello' ] ] ) => [ header, ...events ].map( JSON.stringify ).join( '\n' );
function fixture( text, { chunks, headers } = {} ) {
	let reads = 0;
	let canceled = false;
	let released = false;
	const parts = chunks || [ encode( text ) ];
	const response = { ok: true, headers: new Headers( headers ), body: { getReader: () => ( {
		read: async () => reads < parts.length ? { value: parts[ reads++ ], done: false } : { done: true },
		cancel: () => { canceled = true; return Promise.resolve(); },
		releaseLock: () => { released = true; },
	} ) } };
	const calls = [];
	const fetchImpl = async ( ...args ) => { calls.push( args ); return response; };
	return { fetchImpl, calls, get canceled() { return canceled; }, get released() { return released; } };
}
async function rejectCode( text, code, config = {}, responseOptions ) {
	const input = fixture( text, responseOptions );
	await assert.rejects( loadRecording( '/cast', { fetchImpl: input.fetchImpl, ...config } ), ( error ) => error instanceof RecordingLoadError && error.code === code );
	assert.equal( input.canceled, true );
	assert.equal( input.released, true );
}

test( 'single fetch returns validated v2 data and original metadata', async () => {
	const input = fixture( cast() );
	const metadata = [];
	assert.deepEqual( await loadRecording( '/cast', { fetchImpl: input.fetchImpl, options: { cols: 100 }, onMetadata: ( value ) => metadata.push( value ) } ), [ h2, [ 0, 'o', 'hello' ] ] );
	assert.deepEqual( metadata, [ { cols: 80, rows: 24 } ] );
	assert.equal( input.calls.length, 1 );
	assert.equal( input.calls[ 0 ][ 1 ].credentials, 'same-origin' );
	assert.ok( input.calls[ 0 ][ 1 ].signal instanceof AbortSignal );
	assert.equal( input.canceled, false );
	assert.equal( input.released, true );
} );

test( 'stream boundaries preserve UTF-8, escapes, and CRLF', async () => {
	const content = cast( h3, [ [ 0, 'o', '你好 🌱 " \\ \n' ], [ 1, 'x-custom', 'safe' ] ] ).replaceAll( '\n', '\r\n' );
	const bytes = encode( content );
	const input = fixture( '', { chunks: Array.from( bytes, ( byte ) => Uint8Array.of( byte ) ) } );
	assert.deepEqual( await loadRecording( '/cast', { fetchImpl: input.fetchImpl } ), [ h3, [ 0, 'o', '你好 🌱 " \\ \n' ], [ 1, 'x-custom', 'safe' ] ] );
} );

test( 'blank, comment, and non-event lines retain upstream filtering semantics', async () => {
	const content = `${ JSON.stringify( h3 ) }\n\n# comment\nignored\n [999999,"o","ignored"]\n[0,"o","ok"]\n`;
	assert.deepEqual( await loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl } ), [ h3, [ 0, 'o', 'ok' ] ] );
} );

test( 'v1 compact, pretty, CRLF, and large single line are accepted as objects', async () => {
	const header = { version: 1, width: 80, height: 24, stdout: [ [ 0.1, 'hello' ], [ 0.2, 'world' ] ] };
	for ( const content of [ JSON.stringify( header ), JSON.stringify( header, null, 2 ), JSON.stringify( header, null, 2 ).replaceAll( '\n', '\r\n' ) ] ) {
		assert.deepEqual( await loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl } ), header );
	}
	const large = { ...header, stdout: [ [ 0, 'x'.repeat( DEFAULT_LIMITS.lineBytes ) ] ] };
	assert.deepEqual( await loadRecording( '/cast', { fetchImpl: fixture( JSON.stringify( large ) ).fetchImpl } ), large );
} );

test( 'normal 100000-frame v1 fits preparse allocation budgets', async () => {
	const header = { version: 1, width: 80, height: 24, stdout: Array.from( { length: 100000 }, () => [ 0, '' ] ) };
	const result = await loadRecording( '/cast', { fetchImpl: fixture( JSON.stringify( header ) ).fetchImpl } );
	assert.equal( result.stdout.length, 100000 );
} );

test( 'zero header dimensions preserve default behavior and unknown metadata', async () => {
	for ( const header of [ { ...h2, width: 0, height: 0 }, { version: 3, term: { cols: 0, rows: 0 } } ] ) {
		let metadata = 'unset';
		const result = await loadRecording( '/cast', { fetchImpl: fixture( cast( header ) ).fetchImpl, onMetadata: ( value ) => { metadata = value; } } );
		assert.deepEqual( result[ 0 ], header );
		assert.equal( metadata, null );
	}
} );

test( 'actual received bytes reject oversized chunks despite missing or false Content-Length', async () => {
	for ( const headers of [ {}, { 'Content-Length': '1' }, { 'Content-Length': 'not-a-number' } ] ) {
		await rejectCode( cast(), 'bytes', { limits: { bytes: 10 } }, { headers } );
	}
	// An advertised size is not a replacement for measuring decoded bytes.
	assert.equal( ( await loadRecording( '/cast', { fetchImpl: fixture( cast(), { headers: { 'Content-Length': '999999999' } } ).fetchImpl } ) ).length, 2 );
} );

test( 'line byte limit counts multibyte output and ignored lines', async () => {
	await rejectCode( cast( h2, [ [ 0, 'o', '界'.repeat( 30 ) ] ] ), 'line', { limits: { lineBytes: 80 } } );
	await rejectCode( `${ JSON.stringify( h2 ) }\n#${ 'x'.repeat( 81 ) }`, 'line', { limits: { lineBytes: 80 } } );
} );

test( 'v1 byte cap covers pretty documents and compact documents', async () => {
	const header = { version: 1, width: 80, height: 24, stdout: [ [ 0, 'x'.repeat( 100 ) ] ] };
	await rejectCode( JSON.stringify( header, null, 2 ), 'bytes', { limits: { v1Bytes: 100 } } );
	await rejectCode( JSON.stringify( header ), 'line', { limits: { v1Bytes: 100 } } );
} );

test( 'depth, container, and token budgets run before parsing unknown metadata', async () => {
	await rejectCode( cast( { ...h2, extra: [ [ [ [] ] ] ] } ), 'complexity', { limits: { depth: 4 } } );
	await rejectCode( cast( { ...h2, extra: [ [], [], [] ] } ), 'complexity', { limits: { containers: 4 } } );
	await rejectCode( cast( { ...h2, extra: [ 1, 2, 3, 4, 5 ] } ), 'complexity', { limits: { lineTokens: 10 } } );
} );

test( 'event and marker boundaries are inclusive', async () => {
	const content = cast( h2, [ [ 0, 'm', 'one' ], [ 1, 'm', 'two' ] ] );
	assert.equal( ( await loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl, limits: { markers: 2, events: 2 } } ) ).length, 3 );
	await rejectCode( content, 'markers', { limits: { markers: 1 } } );
	await rejectCode( content, 'events', { limits: { events: 1 } } );
	await rejectCode( content, 'markers', { options: { markers: [ [ 0, 'external' ] ] }, limits: { markers: 2 } } );
} );

test( 'all dimensions, late resizes, raw cells and independent effective overrides are validated', async () => {
	await rejectCode( cast( { ...h2, width: 1001 } ), 'dimensions', { options: { cols: 80 } } );
	await rejectCode( cast( { ...h2, width: 1000, height: 1000 } ), 'cells', { options: { cols: 80, rows: 24 } } );
	await rejectCode( cast( { ...h2, height: 100 } ), 'cells', { options: { cols: 1000 } } );
	await rejectCode( cast(), 'cells', { options: { cols: 1000, rows: 1000 } } );
	for ( const resize of [ '0x24', '80x0', '1001x24', '-1x24', '80x24oops' ] ) {
		await rejectCode( cast( h2, [ [ 0, 'o', 'safe' ], [ 100, 'r', resize ] ] ), 'dimensions' );
	}
	await rejectCode( cast( h2, [ [ 100, 'r', '80x100' ] ] ), 'cells', { options: { cols: 1000 } } );
	assert.equal( ( await loadRecording( '/cast', { fetchImpl: fixture( cast( { ...h2, width: 1000, height: 40 } ) ).fetchImpl } ) ).length, 2 );
} );

test( 'non-finite timestamps and cumulative time overflow are rejected', async () => {
	await rejectCode( `${ JSON.stringify( h2 ) }\n[1e999,"o","x"]`, 'time' );
	await rejectCode( cast( h2, [ [ -1, 'o', 'x' ] ] ), 'time' );
	await rejectCode( cast( h3, [ [ 1e305, 'o', 'x' ], [ 1e305, 'o', 'x' ] ] ), 'time' );
	await rejectCode( JSON.stringify( { version: 1, width: 80, height: 24, stdout: [ [ 1e305, 'x' ], [ 1e305, 'x' ] ] } ), 'time' );
} );

test( 'supported timeline boundary is inclusive across all formats and timing metadata', async () => {
	const maxSeconds = DEFAULT_LIMITS.timelineMs / 1000;
	assert.equal( DEFAULT_LIMITS.timelineMs, 2147483647 );
	for ( const version of [ 1, 2, 3 ] ) {
		const header = version === 3 ? h3 : { ...h2, version };
		const content = ( seconds, extra = {} ) => version === 1
			? JSON.stringify( { ...header, ...extra, stdout: [ [ seconds, 'x' ] ] } )
			: cast( { ...header, ...extra }, [ [ seconds, 'o', 'x' ] ] );
		assert.ok( await loadRecording( '/cast', { fetchImpl: fixture( content( maxSeconds ) ).fetchImpl } ) );
		await rejectCode( content( maxSeconds + 0.001 ), 'time' );
		await rejectCode( content( -0.001 ), 'time' );
		for ( const key of [ 'duration', 'idle_time_limit' ] ) {
			assert.ok( await loadRecording( '/cast', { fetchImpl: fixture( content( 0, { [ key ]: maxSeconds } ) ).fetchImpl } ) );
			for ( const value of [ maxSeconds + 0.001, -0.001, '1', null ] ) await rejectCode( content( 0, { [ key ]: value } ), 'time' );
		}
	}
} );

test( 'relative formats accumulate individually converted milliseconds in upstream order', async () => {
	const maxSeconds = DEFAULT_LIMITS.timelineMs / 1000;
	const rounding = [ 307699.2378567164, 1839784.4091432837 ];
	assert.equal( ( rounding[ 0 ] + rounding[ 1 ] ) * 1000, DEFAULT_LIMITS.timelineMs );
	assert.ok( rounding[ 0 ] * 1000 + rounding[ 1 ] * 1000 > DEFAULT_LIMITS.timelineMs );
	for ( const version of [ 1, 3 ] ) {
		const content = ( intervals ) => version === 1
			? JSON.stringify( { version: 1, width: 80, height: 24, stdout: intervals.map( ( time ) => [ time, 'x' ] ) } )
			: cast( h3, intervals.map( ( time ) => [ time, 'o', 'x' ] ) );
		assert.ok( await loadRecording( '/cast', { fetchImpl: fixture( content( [ 1, maxSeconds - 1 ] ) ).fetchImpl } ) );
		for ( const intervals of [ [ 1, maxSeconds ], rounding, [ 2.996155224770526e303, 1.7677315826146105e305 ] ] ) {
			await rejectCode( content( intervals ), 'time' );
		}
	}
	await rejectCode( cast( h2, [ [ 1e20, 'o', 'x' ] ] ), 'time' );
} );

test( 'slow playback stays within native timer range without expanding the base horizon at higher speeds', async () => {
	const maxSeconds = DEFAULT_LIMITS.timelineMs / 1000;
	for ( const version of [ 1, 2, 3 ] ) {
		const content = ( seconds ) => version === 1
			? JSON.stringify( { version: 1, width: 80, height: 24, stdout: [ [ seconds, 'x' ] ] } )
			: cast( version === 3 ? h3 : h2, [ [ seconds, 'o', 'x' ] ] );
		for ( const speed of [ 0.01, 0.5, 1, 100 ] ) {
			const seconds = maxSeconds * Math.min( speed, 1 );
			const options = { speed };
			assert.ok( await loadRecording( '/cast', { fetchImpl: fixture( content( seconds ) ).fetchImpl, options } ) );
			await rejectCode( content( seconds + 0.001 ), 'time', { options } );
		}
	}
	// An idle limiter or late start does not waive validation of the raw horizon.
	await rejectCode( cast( h2, [ [ maxSeconds, 'o', 'x' ] ] ), 'time', { options: { speed: 0.01, idleTimeLimit: 0.001, startAt: maxSeconds } } );
} );

test( 'normalized timing options are checked before any recording request', async () => {
	const maxSeconds = DEFAULT_LIMITS.timelineMs / 1000;
	for ( const options of [
		...[ 0, -1, NaN, Infinity, 0.009, 101, '1' ].map( ( speed ) => ( { speed } ) ),
		...[ 'startAt', 'idleTimeLimit' ].flatMap( ( key ) => [ maxSeconds + 0.001, -1, Infinity, NaN ].map( ( value ) => ( { [ key ]: value } ) ) ),
		{ poster: 'npt:596:31:23.648' },
		normalizePlayerOptions( { startAt: `${ '9'.repeat( 400 ) }:00:00` } ),
		normalizePlayerOptions( { poster: `npt:${ '9'.repeat( 400 ) }:00:00` } ),
	] ) {
		const input = fixture( cast() );
		await assert.rejects( loadRecording( '/cast', { fetchImpl: input.fetchImpl, options } ), { code: 'time' } );
		assert.equal( input.calls.length, 0 );
	}
	for ( const options of [ { startAt: maxSeconds, idleTimeLimit: maxSeconds }, { poster: 'npt:596:31:23.647' }, { poster: 'data:text/plain,2147483648' } ] ) {
		assert.ok( await loadRecording( '/cast', { fetchImpl: fixture( cast() ).fetchImpl, options } ) );
	}
	await assert.rejects( loadRecording( '/cast', { limits: { timelineMs: DEFAULT_LIMITS.timelineMs + 1 } } ), { code: 'policy' } );
	assert.ok( await loadRecording( '/cast', { fetchImpl: fixture( cast( h2, [ [ 1, 'o', 'x' ] ] ) ).fetchImpl, limits: { timelineMs: 1000 } } ) );
	await rejectCode( cast( h2, [ [ 1.001, 'o', 'x' ] ] ), 'time', { limits: { timelineMs: 1000 } } );
} );

test( 'invalid records do not report metadata', async () => {
	for ( const content of [ '', '{}', cast( h2, [ [ 0, 'o', {} ] ] ), cast( h2, [ [ 0, '', 'x' ] ] ), `${ JSON.stringify( h2 ) }\n[invalid` ] ) {
		let notified = false;
		await assert.rejects( loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl, onMetadata: () => { notified = true; } } ) );
		assert.equal( notified, false );
	}
} );

test( 'invalid UTF-8 cannot be repaired across a newline', async () => {
	await rejectCode( '', 'invalid', {}, { chunks: [ encode( `${ JSON.stringify( h2 ) }\n` ), Uint8Array.of( 0xe2, 10, 0x82, 0xac ) ] } );
} );

test( 'untrusted prototype-shaped metadata remains inert', async () => {
	const header = JSON.parse( '{"version":2,"width":80,"height":24,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}' );
	const result = await loadRecording( '/cast', { fetchImpl: fixture( cast( header ) ).fetchImpl } );
	assert.equal( {}.polluted, undefined );
	assert.equal( Object.getPrototypeOf( result[ 0 ] ), Object.prototype );
	assert.equal( Object.hasOwn( result[ 0 ], '__proto__' ), true );
} );

test( 'pre-abort never fetches', async () => {
	const controller = new AbortController();
	controller.abort();
	const input = fixture( cast() );
	await assert.rejects( loadRecording( '/cast', { fetchImpl: input.fetchImpl, signal: controller.signal } ), { code: 'aborted' } );
	assert.equal( input.calls.length, 0 );
} );

test( 'abort and idle timeout interrupt stalled reads even when cancellation stalls', async () => {
	for ( const explicitAbort of [ true, false ] ) {
		const controller = new AbortController();
		let canceled = false;
		let fetchSignal;
		const fetchImpl = async ( _, config ) => {
			fetchSignal = config.signal;
			return { ok: true, body: { getReader: () => ( { read: () => new Promise( () => {} ), cancel: () => { canceled = true; return new Promise( () => {} ); }, releaseLock() {} } ) } };
		};
		const promise = loadRecording( '/cast', { fetchImpl, signal: controller.signal, limits: { idleTimeoutMs: explicitAbort ? 1000 : 10 } } );
		if ( explicitAbort ) setTimeout( () => controller.abort(), 5 );
		await assert.rejects( promise, { code: explicitAbort ? 'aborted' : 'timeout' } );
		assert.equal( canceled, true );
		assert.equal( fetchSignal.aborted, true );
	}
} );

test( 'total deadline interrupts an indefinitely pending fetch', async () => {
	await assert.rejects( loadRecording( '/cast', { fetchImpl: () => new Promise( () => {} ), limits: { totalTimeoutMs: 10, idleTimeoutMs: 1000 } } ), { code: 'timeout' } );
} );

test( 'unsupported streaming and network failures use stable codes', async () => {
	await assert.rejects( loadRecording( '/cast', { fetchImpl: async () => ( { ok: true } ) } ), { code: 'stream' } );
	await assert.rejects( loadRecording( '/cast', { fetchImpl: async () => ( { ok: false } ) } ), { code: 'network' } );
	await assert.rejects( loadRecording( '/cast', { fetchImpl: async () => { throw new TypeError( 'Failed to fetch' ); } } ), { code: 'network' } );
} );

test( 'ignored JSONL lines count toward the processing budget', async () => {
	await rejectCode( `${ JSON.stringify( h2 ) }\n\n#comment\n[0,"o","x"]`, 'events', { limits: { lines: 2 } } );
} );

test( 'one-byte-over boundaries and exact boundaries use actual body bytes', async () => {
	const content = cast();
	const bytes = encode( content ).byteLength;
	assert.equal( ( await loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl, limits: { bytes } } ) ).length, 2 );
	await rejectCode( content, 'bytes', { limits: { bytes: bytes - 1 } } );
	const first = encode( content.slice( 0, 10 ) );
	const rest = encode( content.slice( 10 ) );
	await rejectCode( '', 'bytes', { limits: { bytes: bytes - 1 } }, { chunks: [ first, rest ] } );
} );

test( 'v1 allocation budgets count scalar tokens separately from containers', async () => {
	const content = JSON.stringify( { version: 1, width: 80, height: 24, stdout: [ [ 0, '' ] ] } );
	// Seven header scalar/key tokens, plus stdout key, then two frame scalars.
	assert.equal( ( await loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl, limits: { tokens: 9, containers: 3 } } ) ).stdout.length, 1 );
	await rejectCode( content, 'complexity', { limits: { tokens: 8 } } );
	await rejectCode( content, 'complexity', { limits: { containers: 2 } } );
} );

test( 'total deadline also bounds continuously resolved reads', async () => {
	let canceled = false;
	const fetchImpl = async () => ( { ok: true, body: { getReader: () => ( {
		read: async () => ( { value: new Uint8Array(), done: false } ),
		cancel: async () => { canceled = true; }, releaseLock() {},
	} ) } } );
	await assert.rejects( loadRecording( '/cast', { fetchImpl, limits: { totalTimeoutMs: 10, idleTimeoutMs: 1000 } } ), { code: 'timeout' } );
	assert.equal( canceled, true );
} );

test( 'initial BOM is removed but later BOM-prefixed lines remain ignored', async () => {
	const content = `\ufeff${ JSON.stringify( h2 ) }\n\ufeff[0,"o","ignored"]\n[1,"o","ok"]`;
	const input = fixture( '', { chunks: Array.from( encode( content ), ( byte ) => Uint8Array.of( byte ) ) } );
	assert.deepEqual( await loadRecording( '/cast', { fetchImpl: input.fetchImpl } ), [ h2, [ 1, 'o', 'ok' ] ] );
} );

test( 'v2 absolute timestamps cannot move backward; equal timestamps remain valid', async () => {
	await rejectCode( cast( h2, [ [ 2, 'o', 'x' ], [ 1, 'o', 'y' ] ] ), 'time' );
	assert.equal( 10004.674 * 1000, 10004.673999999999 * 1000 );
	await rejectCode( cast( h2, [ [ 10004.674, 'o', 'x' ], [ 10004.673999999999, 'o', 'y' ] ] ), 'time' );
	assert.equal( ( await loadRecording( '/cast', { fetchImpl: fixture( cast( h2, [ [ 1, 'o', 'x' ], [ 1, 'o', 'y' ] ] ) ).fetchImpl } ) ).length, 3 );
} );

test( 'JSONL line budget includes newline bytes like the upload validator', async () => {
	const headerLine = JSON.stringify( h2 );
	await rejectCode( `${ headerLine }\n`, 'line', { limits: { lineBytes: encode( headerLine ).length } } );
} );

test( 'v2 header complexity is rejected before allocating the header JSON tree', async () => {
	const content = cast( { ...h2, extra: Array( 40 ).fill( 1 ) } );
	const original = JSON.parse;
	let treeParses = 0;
	JSON.parse = ( text, ...args ) => {
		if ( text.startsWith( '{' ) ) treeParses++;
		return original( text, ...args );
	};
	try {
		await rejectCode( content, 'complexity', { limits: { lineTokens: 20 } } );
		assert.equal( treeParses, 0 );
	} finally { JSON.parse = original; }
} );

test( 'version sniffing honors escaped keys, nesting and last duplicate value', async () => {
	const v1 = '{"stdout":[[0,"ok"]],"nested":{"version":2},"width":80,"height":24,"vers\\u0069on":1}';
	assert.equal( ( await loadRecording( '/cast', { fetchImpl: fixture( v1 ).fetchImpl } ) ).version, 1 );
	const v2 = '{"version":1,"width":80,"height":24,"extra":[1,2,3,4,5,6,7,8,9,10],"version":2}';
	await rejectCode( v2, 'complexity', { limits: { lineTokens: 15 } } );
} );


test( 'initial options are validated synchronously before the player can allocate a terminal', () => {
	assert.doesNotThrow( () => validateInitialDimensions() );
	assert.doesNotThrow( () => validateInitialDimensions( { cols: 1000, rows: 40 } ) );
	assert.throws( () => validateInitialDimensions( { cols: 1000, rows: 1000 } ), { code: 'cells' } );
	assert.throws( () => validateInitialDimensions( { rows: 1000 } ), { code: 'cells' } );
	assert.throws( () => validateInitialDimensions( { cols: 1001 } ), { code: 'dimensions' } );
	assert.throws( () => validateInitialDimensions( { cols: -1 } ), { code: 'dimensions' } );
	assert.throws( () => validateInitialDimensions( { rows: NaN } ), { code: 'dimensions' } );
	assert.throws( () => validateInitialDimensions( { cols: 0 } ), { code: 'dimensions' } );
} );


test( 'multiline v1 can put version after an allocation-heavy first member', async () => {
	const frames = Array( 10001 ).fill( '[0,""]' ).join( ',' );
	const content = `{"stdout":[${ frames }],\n"version":1,"width":80,"height":24}`;
	const result = await loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl } );
	assert.equal( result.version, 1 );
	assert.equal( result.stdout.length, 10001 );
} );

test( 'multiline v1 can put version after a first line larger than the JSONL cap', async () => {
	const title = 'x'.repeat( DEFAULT_LIMITS.lineBytes );
	const content = `{"title":"${ title }",\n"version":1,"width":80,"height":24,"stdout":[[0,""]]}`;
	const result = await loadRecording( '/cast', { fetchImpl: fixture( content ).fetchImpl } );
	assert.equal( result.version, 1 );
	assert.equal( result.title.length, title.length );
} );
