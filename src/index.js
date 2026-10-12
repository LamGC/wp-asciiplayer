import { createBlock, registerBlockType } from '@wordpress/blocks';
import { next } from '@wordpress/shortcode';
import { decodeEntities } from '@wordpress/html-entities';
import metadata from '../block.json';
import Edit from './edit.js';
import { attributesFromShortcode, canTransformShortcode, normalizeSource } from './options.js';
import './style.css';
import './editor.css';

function matchShortcodeBlock( text = '' ) {
	const match = next( 'asciiplayer', text );
	return match && text.trim() === match.content.trim() && canTransformShortcode( match.shortcode.attrs ) && normalizeSource( decodeEntities( match.shortcode.content ) ) ? match : null;
}

registerBlockType( metadata.name, {
	...metadata,
	edit: Edit,
	save: () => null,
	transforms: {
		from: [
			{
				type: 'shortcode',
				tag: 'asciiplayer',
				isMatch: canTransformShortcode,
				transform: ( { named }, match ) => {
					const source = decodeEntities( match.shortcode.content || '' );
					if ( ! normalizeSource( source ) ) return createBlock( 'core/shortcode', { text: match.content } );
					return createBlock( metadata.name, attributesFromShortcode( named, source ) );
				},
			},
			{
				type: 'block',
				blocks: [ 'core/shortcode' ],
				isMatch: ( { text } ) => Boolean( matchShortcodeBlock( text ) ),
				transform: ( { text } ) => {
					const match = matchShortcodeBlock( text );
					return createBlock( metadata.name, attributesFromShortcode( match.shortcode.attrs.named, decodeEntities( match.shortcode.content ) ) );
				},
			},
		],
	},
} );
