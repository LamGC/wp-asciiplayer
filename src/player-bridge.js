/**
 * asciinema uses realm-global document/HTMLButtonElement internally. Execute its
 * bundled script in the canvas document, not in the parent React document.
 */
const pendingDocuments = new WeakMap();
const pendingStyles = new WeakMap();

function findAsset( document, selector, property ) {
	return document.querySelector( selector )?.[ property ];
}

export function playerAssets( hostWindow = window ) {
	const settings = hostWindow.wpAsciiplayerSettings || {};
	return {
		script: settings.playerScriptUrl || findAsset( hostWindow.document, '#lamgc-asciiplayer-player-js', 'src' ),
		style: settings.playerStyleUrl || findAsset( hostWindow.document, '#lamgc-asciiplayer-player-style-css', 'href' ),
	};
}

function ensureStyle( document, url ) {
	if ( ! url ) return Promise.reject( new Error( 'The local player stylesheet is unavailable.' ) );
	let link = Array.from( document.querySelectorAll( 'link[rel="stylesheet"]' ) ).find( ( item ) => item.href === url && ( item.sheet || ! item.dataset.asciiplayerFailed ) );
	if ( link?.sheet ) return Promise.resolve();
	if ( pendingStyles.has( document ) ) return pendingStyles.get( document );
	const created = ! link;
	if ( created ) {
		link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = url;
		link.dataset.asciiplayerAsset = 'style';
	}
	const promise = new Promise( ( resolve, reject ) => {
		let timer;
		const cleanup = () => {
			document.defaultView.clearTimeout( timer );
			link.removeEventListener( 'load', loaded );
			link.removeEventListener( 'error', failed );
		};
		const loaded = () => { cleanup(); resolve(); };
		const failed = () => {
			cleanup();
			link.dataset.asciiplayerFailed = 'true';
			if ( created ) link.remove();
			reject( new Error( 'The local player stylesheet could not be loaded.' ) );
		};
		link.addEventListener( 'load', loaded );
		link.addEventListener( 'error', failed );
		timer = document.defaultView.setTimeout( failed, 20000 );
		if ( created ) document.head.appendChild( link );
		if ( link.sheet ) loaded();
	} );
	pendingStyles.set( document, promise );
	promise.then( () => pendingStyles.delete( document ), () => pendingStyles.delete( document ) );
	return promise;
}

export async function playerForDocument( document, assets ) {
	const canvasWindow = document.defaultView;
	if ( ! canvasWindow ) return Promise.reject( new Error( 'The editor canvas is unavailable.' ) );
	// Player metrics are measured at create(), so CSS must finish first.
	await ensureStyle( document, assets.style );
	if ( typeof canvasWindow.AsciinemaPlayer?.create === 'function' ) return Promise.resolve( canvasWindow.AsciinemaPlayer );
	if ( pendingDocuments.has( document ) ) return pendingDocuments.get( document );
	if ( ! assets.script ) return Promise.reject( new Error( 'The local player script is unavailable.' ) );

	const pending = new Promise( ( resolve, reject ) => {
		let script = Array.from( document.scripts ).find( ( item ) => item.src === assets.script && ! item.dataset.asciiplayerFailed );
		const created = ! script;
		if ( created ) {
			script = document.createElement( 'script' );
			script.src = assets.script;
			script.async = true;
			script.dataset.asciiplayerAsset = 'script';
		}
		let timer;
		const cleanup = () => {
			canvasWindow.clearTimeout( timer );
			script.removeEventListener( 'load', loaded );
			script.removeEventListener( 'error', failed );
		};
		const failed = () => {
			cleanup();
			script.dataset.asciiplayerFailed = 'true';
			// Only remove a script we own. A retry can then load a fresh copy.
			if ( created ) script.remove();
			reject( new Error( 'The local player script could not be loaded.' ) );
		};
		const loaded = () => {
			if ( typeof canvasWindow.AsciinemaPlayer?.create !== 'function' ) return failed();
			cleanup();
			resolve( canvasWindow.AsciinemaPlayer );
		};
		script.addEventListener( 'load', loaded );
		script.addEventListener( 'error', failed );
		timer = canvasWindow.setTimeout( failed, 20000 );
		if ( created ) document.head.appendChild( script );
		// Covers a script that finished between the global check and listener setup.
		if ( typeof canvasWindow.AsciinemaPlayer?.create === 'function' ) loaded();
	} );
	pendingDocuments.set( document, pending );
	pending.catch( () => pendingDocuments.delete( document ) );
	return pending;
}
