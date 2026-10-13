<?php
/**
 * Plugin Name: Asciicast Player
 * Plugin URI: https://github.com/LamGC/wp-asciiplayer
 * Description: Add interactive terminal recordings to posts and pages with a block or shortcode.
 * Version: 1.2.2
 * Requires at least: 6.3
 * Requires PHP: 7.4
 * Author: LamGC
 * Author URI: https://blog.lamgc.moe
 * License: GPL-3.0-only
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: wp-asciiplayer
 *
 * @package LamGC\Asciiplayer
 */

namespace LamGC\Asciiplayer;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VERSION = '1.2.2';
const PLUGIN_FILE = __FILE__;
const SHORTCODE = 'asciiplayer';

require_once __DIR__ . '/includes/options.php';
require_once __DIR__ . '/includes/render.php';
require_once __DIR__ . '/includes/assets.php';
require_once __DIR__ . '/includes/uploads.php';

add_action( 'init', __NAMESPACE__ . '\\register_plugin' );
add_action( 'wp_enqueue_scripts', __NAMESPACE__ . '\\enqueue_content_assets' );
add_action( 'wp_footer', __NAMESPACE__ . '\\print_late_styles', 5 );

add_filter( 'upload_mimes', __NAMESPACE__ . '\\allow_cast_upload_mime', 10, 2 );
add_filter( 'wp_check_filetype_and_ext', __NAMESPACE__ . '\\check_cast_filetype', 10, 5 );
add_filter( 'wp_handle_upload_prefilter', __NAMESPACE__ . '\\validate_cast_upload' );
add_filter( 'wp_handle_sideload_prefilter', __NAMESPACE__ . '\\validate_cast_upload' );
