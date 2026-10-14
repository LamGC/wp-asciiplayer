import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_HEADER_BYTES, readRecordingSize, recordingSizeFromHeader } from '../../src/recording-metadata.js';

test( 'original dimensions use each supported asciicast header schema', () => {
	assert.deepEqual( recordingSizeFromHeader( { version: 1, width: 132, height: 43 } ), { cols: 132, rows: 43 } );
	assert.deepEqual( recordingSizeFromHeader( { version: 2, width: 110, height: 35 } ), { cols: 110, rows: 35 } );
	assert.deepEqual( recordingSizeFromHeader( { version: 3, term: { cols: 150, rows: 50 }, width: 1, height: 1 } ), { cols: 150, rows: 50 } );
	assert.deepEqual( recordingSizeFromHeader( { version: 2, width: 1, height: 1000 } ), { cols: 1, rows: 1000 } );
	assert.deepEqual( recordingSizeFromHeader( { version: 2, width: 1500, height: 1200 } ), { cols: 1500, rows: 1200 } );
	assert.deepEqual( recordingSizeFromHeader( { version: 2, width: Number.MAX_SAFE_INTEGER, height: 1 } ), { cols: Number.MAX_SAFE_INTEGER, rows: 1 } );
} );

test( 'missing, unsupported and invalid dimensions stay unknown, never 80 by 24', () => {
	for ( const header of [ null, undefined, '', [], {}, { width: 80, height: 24 }, { version: '2', width: 80, height: 24 }, { version: 4, width: 80, height: 24 }, { version: 3, width: 80, height: 24 }, { version: 3, term: {} } ] ) {
		assert.equal( recordingSizeFromHeader( header ), null );
	}
	for ( const invalid of [ undefined, null, '', '80', true, false, NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1 ] ) {
		assert.equal( recordingSizeFromHeader( { version: 2, width: invalid, height: 24 } ), null );
		assert.equal( recordingSizeFromHeader( { version: 3, term: { cols: 80, rows: invalid } } ), null );
	}
} );

test( 'metadata reads the first header and preserves the full original response for playback', async () => {
	const text = '{"version":2,"width":132,"height":43}\n[1,"r","200x60"]\n[2,"o","hello"]\n';
	const response = new Response( text );
	let clones = 0;
	const clone = response.clone.bind( response );
	response.clone = () => { clones++; return clone(); };
	assert.deepEqual( await readRecordingSize( response ), { cols: 132, rows: 43 } );
	assert.equal( clones, 1 );
	assert.equal( response.bodyUsed, false );
	assert.equal( await response.text(), text );
} );

test( 'v3 reads terminal metadata, not nested output or subsequent resize events', async () => {
	const text = '{"version":3,"env":{"cols":500,"rows":500},"term":{"cols":120,"rows":30}}\n[0,"r","90x20"]\n';
	const response = new Response( text );
	assert.deepEqual( await readRecordingSize( response ), { cols: 120, rows: 30 } );
	await response.text();
} );

function chunkedResponse( chunks ) {
	let reads = 0;
	let canceled = false;
	return {
		response: {
			ok: true,
			body: { getReader() { throw new Error( 'Do not read the original response.' ); } },
			clone: () => ( {
				body: { getReader: () => ( {
					async read() {
						const value = chunks[ reads++ ];
						return value ? { value, done: false } : { done: true };
					},
					cancel() {
						canceled = true;
						// A real tee's cancel can wait for its other branch.
						return new Promise( () => {} );
					},
				} ) },
			} ),
		},
		get reads() { return reads; },
		get canceled() { return canceled; },
	};
}

test( 'pretty-printed v1 reads dimensions before stdout and does not await tee cancellation', async () => {
	const encode = new TextEncoder();
	const stream = chunkedResponse( [
		encode.encode( '{\n  "version": 1,\n  "width": 104,\n' ),
		encode.encode( '  "height": 28,\n  "stdout": [\n' ),
		encode.encode( `[0,${ JSON.stringify( 'output'.repeat( MAX_HEADER_BYTES ) ) }]]}` ),
	] );
	assert.deepEqual( await readRecordingSize( stream.response ), { cols: 104, rows: 28 } );
	assert.equal( stream.reads, 2 );
	assert.equal( stream.canceled, true );
} );

test( 'streaming JSON handles split UTF-8, escapes and nested objects without false fields', async () => {
	const text = JSON.stringify( { title: '尺寸 \\ " }, \\ ', env: { width: 300, height: 500 }, width: 137, height: 47, version: 1, stdout: [] } );
	const chunks = Array.from( new TextEncoder().encode( text ), ( value ) => Uint8Array.of( value ) );
	const stream = chunkedResponse( chunks );
	assert.deepEqual( await readRecordingSize( stream.response ), { cols: 137, rows: 47 } );
	assert.ok( stream.reads < chunks.length );
	assert.equal( stream.canceled, true );
} );

test( 'headers over the byte limit stay unknown without draining the recording', async () => {
	const encode = new TextEncoder();
	const stream = chunkedResponse( [
		encode.encode( '{"version":2,"title":"' + 'x'.repeat( MAX_HEADER_BYTES ) ),
		encode.encode( '","width":132,"height":43}\n[1,"o","hello"]' ),
	] );
	assert.equal( await readRecordingSize( stream.response ), null );
	assert.equal( stream.reads, 1 );
	assert.equal( stream.canceled, true );
} );

test( 'byte limit accepts a complete header at its boundary and ignores larger output chunks', async () => {
	const base = '{"version":2,"width":132,"height":43,"title":"';
	const header = base + 'x'.repeat( MAX_HEADER_BYTES - base.length - 2 ) + '"}';
	const stream = chunkedResponse( [ new TextEncoder().encode( header + '\n[1,"o","' + 'x'.repeat( MAX_HEADER_BYTES ) + '"]' ) ] );
	assert.deepEqual( await readRecordingSize( stream.response ), { cols: 132, rows: 43 } );
	assert.equal( stream.reads, 1 );
} );

test( 'invalid JSON, nested lookalikes and incomplete dimensions never become defaults', async () => {
	for ( const text of [ '', 'not a cast', '<html>error</html>', '[]', '{}', '{"version":2,"env":{"width":80,"height":24}}', '{"version":2,"width":80,"height":24,}', '{"version":2,,"width":80,"height":24}', '{"version":2,"width":80,"height":24]', '{"version":2,"width":80,"height":24', '{"version":3,"term":{"cols":80}}' ] ) {
		const response = new Response( text );
		assert.equal( await readRecordingSize( response ), null, text );
		await response.text();
	}
} );

test( 'failed responses, unavailable streams and rejected reads quietly stay unknown', async () => {
	assert.equal( await readRecordingSize( { ok: false } ), null );
	assert.equal( await readRecordingSize( { ok: true, body: null } ), null );
	assert.equal( await readRecordingSize( { ok: true, body: { getReader() {} }, clone() { throw new Error( 'locked' ); } } ), null );
	const broken = chunkedResponse( [] );
	broken.response.clone = () => ( { body: { getReader: () => ( { read: () => Promise.reject( new Error( 'aborted' ) ), cancel: () => Promise.reject( new Error( 'aborted' ) ) } ) } } );
	assert.equal( await readRecordingSize( broken.response ), null );
} );
