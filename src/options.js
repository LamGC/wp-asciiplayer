/** Shared, side-effect-free validation for the editor and front-end adapter. */
export const DEFAULTS = Object.freeze( {
	theme: 'asciinema', speed: 1, loop: false, controls: 'auto', fit: 'width',
	startAt: 0, idleTimeLimit: 0, autoPlay: false, preload: true, width: '100%',
} );

export function booleanValue( value, fallback = false ) {
	if ( typeof value === 'boolean' ) return value;
	if ( value === 1 || /^(true|1|yes|on)$/i.test( String( value ).trim() ) ) return true;
	if ( value === 0 || /^(false|0|no|off)$/i.test( String( value ).trim() ) ) return false;
	return fallback;
}

export function finiteNumber( value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER ) {
	if ( typeof value !== 'number' && typeof value !== 'string' ) return fallback;
	if ( typeof value === 'string' && ! /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test( value.trim() ) ) return fallback;
	const number = Number( value );
	return Number.isFinite( number ) && number >= min && number <= max ? number : fallback;
}

/** Accept explicit web URLs and site-root-relative URLs; never executable schemes. */
export function normalizeSource( input ) {
	if ( typeof input !== 'string' ) return '';
	const source = input.trim();
	if ( ! source || /[\u0000-\u0020\u007f<>"\\]/.test( source ) ) return '';
	if ( /^\/(?!\/)/.test( source ) ) return source;
	// URL() repairs missing/extra authority slashes; PHP deliberately does not.
	if ( ! /^https?:\/\/[^/]/i.test( source ) ) return '';
	try {
		const url = new URL( source );
		return [ 'http:', 'https:' ].includes( url.protocol ) && ! url.username && ! url.password ? source : '';
	} catch {
		return '';
	}
}

export function normalizeWidth( value ) {
	return typeof value === 'string' && /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|em|rem|vw|vh|vmin|vmax|ch))$/.test( value.trim() )
		? value.trim() : DEFAULTS.width;
}

/** A bounded editor frame for old height-fitting shortcodes; never persisted. */
export function previewHeight( attributes ) {
	if ( ! [ 'height', 'both' ].includes( attributes.fit ) ) return undefined;
	let height = '320px';
	for ( const declaration of String( attributes.legacyStyle || '' ).split( ';' ) ) {
		const match = declaration.match( /^\s*height\s*:\s*((?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|vh|vw|vmin|vmax|ch))\s*$/i );
		if ( match ) height = match[ 1 ];
	}
	return height;
}

export function normalizeControls( value ) {
	if ( typeof value === 'string' ) value = value.trim().toLowerCase();
	if ( value === 'always' || booleanValue( value, null ) === true ) return true;
	if ( value === 'never' || booleanValue( value, null ) === false ) return false;
	return 'auto';
}

export function secondsValue( value ) {
	if ( typeof value === 'string' && /^\d+(?::[0-5]?\d){1,2}(?:\.\d+)?$/.test( value.trim() ) ) {
		return value.trim().split( ':' ).reduce( ( total, part ) => total * 60 + Number( part ), 0 );
	}
	return finiteNumber( value, 0 );
}

export function normalizePlayerOptions( attributes = {}, { preview = false } = {} ) {
	const fit = typeof attributes.fit === 'string' ? attributes.fit.trim().toLowerCase() : attributes.fit;
	const fontSize = typeof attributes.terminalFontSize === 'string' ? attributes.terminalFontSize.trim().toLowerCase() : '';
	const fontFamily = typeof attributes.terminalFontFamily === 'string' ? attributes.terminalFontFamily.trim() : '';
	const options = {
		theme: typeof attributes.theme === 'string' && /^(?:auto\/)?[\w-]{1,64}$/.test( attributes.theme ) ? attributes.theme : DEFAULTS.theme,
		speed: finiteNumber( attributes.speed, 1, 0.01, 100 ),
		loop: booleanValue( attributes.loop ),
		controls: normalizeControls( attributes.controls ),
		fit: [ 'width', 'height', 'both', 'none' ].includes( fit ) ? fit : booleanValue( fit, null ) === false ? 'none' : 'width',
		startAt: secondsValue( attributes.startAt ),
		autoPlay: preview ? false : booleanValue( attributes.autoPlay ?? attributes.autoplay ),
		preload: preview ? true : booleanValue( attributes.preload, true ),
	};
	// Shortcodes may intentionally request a finite number of loops.
	if ( typeof attributes.loop === 'number' && attributes.loop > 0 && Number.isInteger( attributes.loop ) ) options.loop = attributes.loop;
	const idle = finiteNumber( attributes.idleTimeLimit, 0 );
	if ( idle > 0 ) options.idleTimeLimit = idle;
	for ( const key of [ 'cols', 'rows' ] ) {
		const number = finiteNumber( attributes[ key ], 0, 1, 1000 );
		if ( Number.isInteger( number ) && number > 0 ) options[ key ] = number;
	}
	const lineHeight = finiteNumber( attributes.terminalLineHeight, 0, 0.1, 10 );
	if ( lineHeight ) options.terminalLineHeight = lineHeight;
	if ( fontFamily.length <= 300 && /^[a-zA-Z0-9 _.,'"-]+$/.test( fontFamily ) ) options.terminalFontFamily = fontFamily;
	if ( /^(small|medium|big|0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|em|rem|vw|vh|vmin|vmax|ch))$/.test( fontSize ) ) options.terminalFontSize = fontSize;
	if ( typeof attributes.poster === 'string' && attributes.poster.length <= 32768 && /^(npt:\d+(?::[0-5]?\d){0,2}(?:\.\d+)?|data:text\/plain,[\s\S]*)$/.test( attributes.poster ) ) options.poster = attributes.poster;
	return options;
}

const SHORTCODE_KEYS = {
	theme: 'theme', speed: 'speed', loop: 'loop', controls: 'controls', fit: 'fit',
	startat: 'startAt', idletimelimit: 'idleTimeLimit', autoplay: 'autoPlay', preload: 'preload',
	cols: 'cols', rows: 'rows', terminalfontfamily: 'terminalFontFamily',
	terminalfontsize: 'terminalFontSize', terminallineheight: 'terminalLineHeight', poster: 'poster', style: 'legacyStyle',
	fontsize: 'terminalFontSize', fontfamily: 'terminalFontFamily', lineheight: 'terminalLineHeight', width: 'width',
};

/** Unknown legacy options stay in their original shortcode rather than being lost. */
export function canTransformShortcode( { named = {}, numeric = [] } = {} ) {
	return numeric.length === 0 && Object.entries( named ).every( ( [ key, value ] ) => {
		const lower = key.toLowerCase();
		if ( ! Object.prototype.hasOwnProperty.call( SHORTCODE_KEYS, lower ) ) return false;
		if ( lower === 'loop' && booleanValue( value, null ) === null ) return false;
		if ( lower === 'style' ) {
			const widths = String( value ).matchAll( /(?:^|;)\s*width\s*:\s*([^;]+)/gi );
			for ( const match of widths ) if ( normalizeWidth( match[ 1 ] ) !== match[ 1 ].trim() ) return false;
		}
		return true;
	} );
}

export function attributesFromShortcode( named = {}, content = '' ) {
	const values = {};
	for ( const [ key, value ] of Object.entries( named ) ) {
		const target = SHORTCODE_KEYS[ key.toLowerCase() ];
		if ( target ) values[ target ] = value;
	}
	if ( values.fit === 'false' || values.fit === false ) values.fit = 'none';
	const normalized = normalizePlayerOptions( values );
	const attributes = {
		...normalized,
		source: normalizeSource( content ),
		controls: normalized.controls === true ? 'always' : normalized.controls === false ? 'never' : 'auto',
		idleTimeLimit: normalized.idleTimeLimit ?? 0,
	};
	if ( values.legacyStyle ) {
		attributes.legacyStyle = values.legacyStyle;
		for ( const match of String( values.legacyStyle ).matchAll( /(?:^|;)\s*width\s*:\s*([^;]+)/gi ) ) attributes.width = normalizeWidth( match[ 1 ] );
	}
	if ( values.width ) attributes.width = normalizeWidth( values.width );
	return attributes;
}
