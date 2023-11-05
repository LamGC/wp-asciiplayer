<?php

/*
Plugin Name: Asciicast Player
Plugin URI: https://github.com/LamGC/wp-asciiplayer
Description: AsciinemaPlayer for WordPress.
Version: 1.0.0
Author: LamGC
Author URI: https://blog.lamgc.moe
License: GNU GENERAL PUBLIC LICENSE Version 3.0
*/

const PLUGIN_VERSION = '1.0.1';

const ASCIIPLAYER_TAG = 'asciiplayer';

const AP_OPTION_USE_LOCAL_RESOURCES = 'ap_use_local_resources';

// 是否使用本地资源, 如果可以的话, 建议使用 CDN.
add_option(AP_OPTION_USE_LOCAL_RESOURCES, false, $autoload = true);

function handle_asciiplayer_code($attr = [], string $content = null): string
{
    if (!isset($content)) {
        return '';
    }
    $content = trim($content);
    if (!is_array(wp_parse_url($content))) {
        return '';
    }
    $opts = is_assoc($attr) ? $attr : [];

    set_default_value($opts, 'preload', true);

    $style = null;
    if (isset($opts['style']) && is_string($opts['style'])) {
        $style = $opts['style'];
    }
    unset($opts['style']);

    $opts_json = urlencode_deep(json_encode($opts));
    return "<div 
                class=\"asciiplayer-container\"
                data-ap-src=\"$content\"
                data-ap-opts=\"$opts_json\"
                data-ap-style=\"$style\"
            ></div>";
}

function is_assoc($arr): bool
{
    if (!is_array($arr)) return false;
    if (array() === $arr) return false;
    return array_keys($arr) !== range(0, count($arr) - 1);
}


function set_default_value(array &$array, string $key, $value)
{
    if (!isset($array[$key])) {
        $array[$key] = $value;
    }
}

add_shortcode(ASCIIPLAYER_TAG, 'handle_asciiplayer_code');

function load_scripts()
{
    if (!is_single()) {
        return;
    }
    global $post;
    if (has_shortcode($post->post_content, ASCIIPLAYER_TAG)) {
        wp_enqueue_script(
            'asciiplayer-adapter-js',
            get_adapter_url() . '/dist/bundle.js',
            array(),
            PLUGIN_VERSION
        );
        wp_enqueue_style(
            'asciiplayer-adapter-css',
            get_adapter_url() . '/dist/styles.css',
            array(),
            PLUGIN_VERSION
        );
    }
}

add_action('wp_enqueue_scripts', 'load_scripts');

function get_adapter_url(): string
{
    $use_local_resources = boolval(get_option(AP_OPTION_USE_LOCAL_RESOURCES, true));
    $version = PLUGIN_VERSION;
    if ($use_local_resources) {
        return plugin_dir_url(__FILE__) . '/asciiplayer';
    } else {
        return "https://cdn.jsdelivr.net/npm/wp-asciiplayer-adapter@$version";
    }
}
