/** TEST ONLY. Materialize one pinned fixture; never accepts arbitrary sizes. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest, createRecipes, MAX_FIXTURE_BYTES } from './recipes.mjs';

const root = dirname( fileURLToPath( import.meta.url ) );
const manifestPath = join( root, 'manifest.json' );
const invoked = process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url );

// Maintenance only: deterministic recipes write the small fixtures plus golden
// manifest. No large expanded payload is ever written into the repository.
if ( invoked && process.argv.slice( 2 ).join( ' ' ) === '--refresh' ) {
	const recipes = createRecipes();
	for ( const { entry, parts } of recipes ) {
		if ( ! entry.source.file ) continue;
		if ( entry.provenance === 'official-raw-capture' ) continue;
		if ( entry.bytes > 16384 ) throw new RangeError( 'Checked-in fixtures must stay small.' );
		writeFileSync( join( root, entry.source.file ), parts.map( ( part ) => part.text.repeat( part.repeat ) ).join( '' ), 'utf8' );
	}
	writeFileSync( manifestPath, JSON.stringify( createManifest(), null, 2 ) + '\n', 'utf8' );
	process.stdout.write( `Refreshed ${ recipes.length } recipes and their small controls.\n` );
}

export const securityManifest = JSON.parse( readFileSync( manifestPath, 'utf8' ) );
export const securityCases = securityManifest.cases;

export function getSecurityCase( id ) {
	const fixture = securityCases.find( ( item ) => item.id === id );
	if ( ! fixture ) throw new RangeError( `Unknown security fixture: ${ id }` );
	return fixture;
}

export function securityFixtureBuffer( id ) {
	const fixture = getSecurityCase( id );
	if ( ! Number.isSafeInteger( fixture.bytes ) || fixture.bytes < 1 || fixture.bytes > MAX_FIXTURE_BYTES ) throw new RangeError( 'Fixture byte cap exceeded.' );
	let buffer;
	if ( fixture.source.file ) {
		if ( ! /^[a-z0-9-]+\.cast$/.test( fixture.source.file ) ) throw new Error( 'Fixture file must stay in its own directory.' );
		buffer = readFileSync( join( root, fixture.source.file ) );
	} else {
		let length = 0;
		for ( const { text, repeat } of fixture.source.segments ) {
			if ( typeof text !== 'string' || ! text.length || ! Number.isSafeInteger( repeat ) || repeat < 1 ) throw new Error( 'Invalid literal-repeat segment.' );
			length += Buffer.byteLength( text ) * repeat;
			if ( ! Number.isSafeInteger( length ) || length > MAX_FIXTURE_BYTES ) throw new RangeError( 'Recipe byte cap exceeded.' );
		}
		if ( length !== fixture.bytes ) throw new Error( `Recipe length differs for ${ id }` );
		buffer = Buffer.allocUnsafe( length );
		let offset = 0;
		for ( const { text, repeat } of fixture.source.segments ) {
			const unit = Buffer.from( text, 'utf8' );
			const end = offset + unit.length * repeat;
			buffer.fill( unit, offset, end );
			offset = end;
		}
	}
	if ( buffer.length !== fixture.bytes || createHash( 'sha256' ).update( buffer ).digest( 'hex' ) !== fixture.sha256 ) throw new Error( `Fixture integrity failure: ${ id }` );
	return buffer;
}

export function writeSecurityFixture( id, directory ) {
	const buffer = securityFixtureBuffer( id );
	const path = join( directory, `${ id }.cast` );
	writeFileSync( path, buffer, { flag: 'wx' } );
	return path;
}

if ( invoked ) {
	const args = process.argv.slice( 2 );
	if ( args.length === 1 && args[ 0 ] === '--list' ) {
		for ( const item of securityCases ) process.stdout.write( `${ item.id }\t${ item.bytes } bytes\t${ item.expected.accepted ? 'accept' : item.expected.jsError }\n` );
	} else if ( args.length === 1 && args[ 0 ] === '--verify' ) {
		if ( JSON.stringify( securityManifest ) !== JSON.stringify( createManifest() ) ) throw new Error( 'Golden manifest differs; inspect recipes before --refresh.' );
		for ( const item of securityCases ) securityFixtureBuffer( item.id );
		process.stdout.write( `Verified ${ securityCases.length } deterministic fixtures.\n` );
	} else if ( args.length === 2 && args[ 0 ] === '--case' ) {
		const fixture = getSecurityCase( args[ 1 ] );
		const directory = mkdtempSync( join( tmpdir(), 'asciiplayer-security-' ) );
		const path = writeSecurityFixture( fixture.id, directory );
		process.stdout.write( JSON.stringify( { path, bytes: fixture.bytes, sha256: fixture.sha256, cleanup: `Remove ${ directory } after testing.` }, null, 2 ) + '\n' );
	} else if ( args.length !== 1 || args[ 0 ] !== '--refresh' ) {
		process.stderr.write( 'Usage: node tests/fixtures/security/generate.mjs --list | --verify | --case <known-id> | --refresh\n' );
		process.exitCode = 1;
	}
}
