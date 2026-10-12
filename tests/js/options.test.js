import test from 'node:test';
import assert from 'node:assert/strict';
import { attributesFromShortcode, booleanValue, canTransformShortcode, finiteNumber, normalizeControls, normalizePlayerOptions, normalizeSource, normalizeWidth, previewHeight, secondsValue } from '../../src/options.js';

test( 'source validation permits explicit web URLs and site-relative cast paths', () => {
	for ( const value of [ 'https://example.com/recording.cast', 'http://localhost:8888/a.cast?x=1&y=2', '/uploads/hello.cast', "https://example.com/it's.cast" ] ) assert.equal( normalizeSource( ` ${ value } ` ), value );
} );

test( 'source validation rejects executable, credentialed, ambiguous and malformed URLs', () => {
	for ( const value of [ '', '//evil.test/cast', '/\\evil.test/cast', 'javascript:alert(1)', 'data:text/plain,cast', 'blob:https://example.com/a', 'file:///tmp/a.cast', 'https://user:secret@example.com/a.cast', 'https://example.com/\na.cast', 'https://example.com/<script>', 'relative.cast', {}, null ] ) assert.equal( normalizeSource( value ), '' );
} );

test( 'source validation rejects a missing HTTP authority separator', () => {
	assert.equal( normalizeSource( 'https:example.com/a.cast' ), '' );
} );

test( 'source validation rejects a single HTTP authority slash', () => {
	assert.equal( normalizeSource( 'https:/example.com/a.cast' ), '' );
} );

test( 'source validation rejects an extra HTTP authority slash', () => {
	assert.equal( normalizeSource( 'https:///example.com/a.cast' ), '' );
} );

test( 'string false options never become true through truthiness', () => {
	for ( const value of [ false, 0, 'false', '0', 'off', 'no', ' FALSE ' ] ) assert.equal( booleanValue( value, true ), false );
	for ( const value of [ true, 1, 'true', '1', 'on', 'yes' ] ) assert.equal( booleanValue( value ), true );
	assert.equal( booleanValue( 'wrong', null ), null );
} );

test( 'controls convert editor choices to the actual player API types', () => {
	assert.equal( normalizeControls( 'always' ), true );
	assert.equal( normalizeControls( 'true' ), true );
	assert.equal( normalizeControls( 'never' ), false );
	assert.equal( normalizeControls( 'false' ), false );
	assert.equal( normalizeControls( 'auto' ), 'auto' );
	assert.equal( normalizeControls( 'unexpected' ), 'auto' );
} );

test( 'numeric validation rejects non-finite, empty and boolean values', () => {
	for ( const value of [ Infinity, NaN, '', ' ', {}, null, true, '-1', '101', '0x10', '0b10' ] ) assert.equal( finiteNumber( value, 5, 0, 100 ), 5 );
	assert.equal( finiteNumber( '0', 5 ), 0 );
	assert.equal( finiteNumber( '1.5', 5 ), 1.5 );
} );

test( 'timecodes match the PHP supported syntax and preserve zero', () => {
	assert.equal( secondsValue( '1:02:03.5' ), 3723.5 );
	assert.equal( secondsValue( '2:03.5' ), 123.5 );
	assert.equal( secondsValue( ' 2:03 ' ), 123 );
	for ( const value of [ '1:99', '1:90:00', '1:2:3:4', -1, null ] ) assert.equal( secondsValue( value ), 0 );
} );

test( 'preview forces only its own preload and autoplay settings', () => {
	const attributes = { autoPlay: true, preload: false, speed: 2, controls: 'always', loop: true };
	const saved = normalizePlayerOptions( attributes );
	const preview = normalizePlayerOptions( attributes, { preview: true } );
	assert.equal( saved.autoPlay, true );
	assert.equal( saved.preload, false );
	assert.equal( preview.autoPlay, false );
	assert.equal( preview.preload, true );
	assert.equal( preview.speed, 2 );
	assert.equal( preview.controls, true );
	assert.equal( attributes.autoPlay, true );
} );

test( 'zero idle limit omits the override and finite legacy loops survive playback', () => {
	assert.equal( Object.hasOwn( normalizePlayerOptions( { idleTimeLimit: 0 } ), 'idleTimeLimit' ), false );
	assert.equal( normalizePlayerOptions( { idleTimeLimit: 2 } ).idleTimeLimit, 2 );
	assert.equal( normalizePlayerOptions( { loop: 3 } ).loop, 3 );
	assert.equal( normalizePlayerOptions( { fit: false } ).fit, 'none' );
} );

test( 'optional dimensions, fonts and posters are validated consistently', () => {
	const options = normalizePlayerOptions( { cols: 120, rows: 35, terminalLineHeight: 0.1, terminalFontFamily: '"Fira Code", monospace', terminalFontSize: '1.2rem', poster: 'npt:2:03' } );
	assert.equal( options.cols, 120 );
	assert.equal( options.rows, 35 );
	assert.equal( options.terminalLineHeight, 0.1 );
	assert.equal( options.terminalFontSize, '1.2rem' );
	assert.equal( options.poster, 'npt:2:03' );
	const invalid = normalizePlayerOptions( { cols: 1.5, rows: 1001, terminalLineHeight: 11, terminalFontFamily: 'x; color:red', terminalFontSize: 'url(https://evil.test)', poster: 'https://evil.test/poster' } );
	for ( const key of [ 'cols', 'rows', 'terminalLineHeight', 'terminalFontFamily', 'terminalFontSize', 'poster' ] ) assert.equal( Object.hasOwn( invalid, key ), false );
} );

test( 'width accepts safe CSS lengths only', () => {
	for ( const value of [ '0', '80%', '640px', '.5rem', '80vw', '30ch' ] ) assert.equal( normalizeWidth( value ), value );
	for ( const value of [ 'calc(100% - 1px)', '80%;color:red', 'expression(alert(1))', 'auto', null ] ) assert.equal( normalizeWidth( value ), '100%' );
} );

test( 'legacy height fitting gets a usable preview without changing saved styles', () => {
	assert.equal( previewHeight( { fit: 'width' } ), undefined );
	assert.equal( previewHeight( { fit: 'height' } ), '320px' );
	assert.equal( previewHeight( { fit: 'both', legacyStyle: 'width:80%; height:400px;' } ), '400px' );
	assert.equal( previewHeight( { fit: 'height', legacyStyle: 'height:expression(alert(1))' } ), '320px' );
} );

test( 'shortcode conversion maps lowercased legacy names and typed booleans', () => {
	const attrs = attributesFromShortcode( { controls: 'false', autoplay: 'true', preload: 'false', startat: '1:23', idletimelimit: '2', fontsize: 'small', fit: 'false', style: 'width: 80%; height: 300px;' }, 'https://example.com/test.cast' );
	assert.equal( attrs.source, 'https://example.com/test.cast' );
	assert.equal( attrs.controls, 'never' );
	assert.equal( attrs.autoPlay, true );
	assert.equal( attrs.preload, false );
	assert.equal( attrs.startAt, 83 );
	assert.equal( attrs.idleTimeLimit, 2 );
	assert.equal( attrs.terminalFontSize, 'small' );
	assert.equal( attrs.fit, 'none' );
	assert.equal( attrs.width, '80%' );
	assert.equal( attrs.legacyStyle, 'width: 80%; height: 300px;' );
} );

test( 'shortcode conversion normalizes legacy option case and whitespace like PHP', () => {
	const attrs = attributesFromShortcode( { fit: ' HEIGHT ', fontsize: ' 15PX ', fontfamily: '  "Fira Code", monospace  ' }, '/example.cast' );
	assert.equal( attrs.fit, 'height' );
	assert.equal( attrs.terminalFontSize, '15px' );
	assert.equal( attrs.terminalFontFamily, '"Fira Code", monospace' );
} );

test( 'lossy transforms are refused, so unsupported legacy shortcodes remain untouched', () => {
	assert.equal( canTransformShortcode( { named: { loop: '2' } } ), false );
	assert.equal( canTransformShortcode( { named: { customOption: 'x' } } ), false );
	assert.equal( canTransformShortcode( { named: { style: 'width:calc(100% - 1px)' } } ), false );
	assert.equal( canTransformShortcode( { named: {}, numeric: [ 'unexpected' ] } ), false );
	assert.equal( canTransformShortcode( { named: { loop: 'true', controls: 'false', style: 'width:80%;height:300px' } } ), true );
} );
