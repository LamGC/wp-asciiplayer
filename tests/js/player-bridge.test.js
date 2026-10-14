import test from 'node:test';
import assert from 'node:assert/strict';
import { playerForDocument } from '../../src/player-bridge.js';

const assets = { script: 'https://site.test/player.js', style: 'https://site.test/player.css' };
const flush = () => new Promise( ( resolve ) => setImmediate( resolve ) );

function fakeDocument() {
	const nodes = [];
	const document = {
		defaultView: { setTimeout, clearTimeout },
		head: { appendChild( node ) { nodes.push( node ); } },
		get scripts() { return nodes.filter( ( node ) => node.tag === 'script' ); },
		querySelectorAll() { return nodes.filter( ( node ) => node.tag === 'link' ); },
		createElement( tag ) {
			const events = new Map();
			return {
				tag, dataset: {},
				addEventListener( name, callback ) { events.set( name, callback ); },
				removeEventListener( name ) { events.delete( name ); },
				dispatch( name ) { events.get( name )?.(); },
				remove() { const index = nodes.indexOf( this ); if ( index >= 0 ) nodes.splice( index, 1 ); },
			};
		},
	};
	return { document, nodes };
}

test( 'bridge waits for CSS even if the player global already exists', async () => {
	const { document, nodes } = fakeDocument();
	const api = { create() {} };
	document.defaultView.AsciinemaPlayer = api;
	let resolved = false;
	const pending = playerForDocument( document, assets ).then( ( value ) => { resolved = true; return value; } );
	await flush();
	assert.equal( resolved, false );
	assert.equal( nodes.length, 1 );
	nodes[ 0 ].sheet = {};
	nodes[ 0 ].dispatch( 'load' );
	assert.equal( await pending, api );
	assert.equal( nodes.length, 1 );
} );

test( 'parallel previews deduplicate local CSS and script and use the canvas realm', async () => {
	const { document, nodes } = fakeDocument();
	const first = playerForDocument( document, assets );
	const second = playerForDocument( document, assets );
	assert.equal( nodes.length, 1 );
	nodes[ 0 ].sheet = {};
	nodes[ 0 ].dispatch( 'load' );
	await flush();
	assert.equal( document.scripts.length, 1 );
	const canvasAPI = { create() {} };
	document.defaultView.AsciinemaPlayer = canvasAPI;
	document.scripts[ 0 ].dispatch( 'load' );
	assert.equal( await first, canvasAPI );
	assert.equal( await second, canvasAPI );
	assert.equal( await playerForDocument( document, assets ), canvasAPI );
} );

test( 'failed owned script is removed and retry starts a new request', async () => {
	const { document, nodes } = fakeDocument();
	const pending = playerForDocument( document, assets );
	const rejection = assert.rejects( pending, /script could not be loaded/ );
	nodes[ 0 ].sheet = {};
	nodes[ 0 ].dispatch( 'load' );
	await flush();
	document.scripts[ 0 ].dispatch( 'error' );
	await rejection;
	assert.equal( document.scripts.length, 0 );
	const retry = playerForDocument( document, assets );
	await flush();
	assert.equal( document.scripts.length, 1 );
	document.defaultView.AsciinemaPlayer = { create() {} };
	document.scripts[ 0 ].dispatch( 'load' );
	assert.equal( await retry, document.defaultView.AsciinemaPlayer );
} );

test( 'failed stylesheet is retryable and never starts a script before CSS', async () => {
	const { document, nodes } = fakeDocument();
	const pending = playerForDocument( document, assets );
	const rejection = assert.rejects( pending, /stylesheet could not be loaded/ );
	nodes[ 0 ].dispatch( 'error' );
	await rejection;
	assert.equal( nodes.length, 0 );
	const retry = playerForDocument( document, assets );
	assert.equal( nodes.length, 1 );
	nodes[ 0 ].sheet = {};
	nodes[ 0 ].dispatch( 'load' );
	await flush();
	document.defaultView.AsciinemaPlayer = { create() {} };
	document.scripts[ 0 ].dispatch( 'load' );
	await retry;
} );

test( 'existing enqueued assets are reused while still loading', async () => {
	const { document, nodes } = fakeDocument();
	const style = document.createElement( 'link' );
	style.href = assets.style;
	style.sheet = {};
	const script = document.createElement( 'script' );
	script.src = assets.script;
	document.head.appendChild( style );
	document.head.appendChild( script );
	const pending = playerForDocument( document, assets );
	await flush();
	assert.equal( nodes.length, 2 );
	document.defaultView.AsciinemaPlayer = { create() {} };
	script.dispatch( 'load' );
	assert.equal( await pending, document.defaultView.AsciinemaPlayer );
} );

test( 'document with no window fails cleanly', async () => {
	await assert.rejects( playerForDocument( { defaultView: null }, assets ), /canvas is unavailable/ );
} );
