<?php
/**
 * Plugin Name: SFC Chatbot Widget
 * Description: Loads the college chatbot widget script once, site-wide, without modifying WordPress core.
 * Version: 1.0.0
 * License: Proprietary
 *
 * The widget itself (button, panel, and chat logic) is hosted with the
 * chatbot service and versioned there. This plugin only enqueues the current
 * script URL on every public page, the way a theme or WordPress itself would.
 */

if (!defined('ABSPATH')) {
    exit;
}

function sfc_chatbot_widget_url(): string
{
    // Point this at the college's chatbot deployment. Sites can override it
    // with the sfc_chatbot_widget_url filter, e.g. when staging and production
    // differ.
    return apply_filters(
        'sfc_chatbot_widget_url',
        'https://chatbot.springfieldcollege.edu/widget/v1.js'
    );
}

/**
 * Cache-busting (ticket 32): the chatbot origin always serves the loader as
 * /widget/v1.js — scripts/build-widget.ts overwrites that one file, and the
 * URL is kept stable on purpose so embeds never break. The content inside
 * v1.js may change freely within "v1", but browsers cache it by URL, so
 * after shipping a loader change, bump the $ver argument in the
 * wp_enqueue_script call below (for example from null to 'v1.1'): WordPress
 * appends it to the URL as ?ver=v1.1, which is all that is needed for
 * visitors' browsers to re-fetch. No renaming is required anywhere else.
 */

add_action('wp_enqueue_scripts', function (): void {
    wp_enqueue_script(
        'sfc-chatbot-widget-v1',
        esc_url(sfc_chatbot_widget_url()),
        array(),
        null,
        true // Load in the footer so page content is never blocked by the chat.
    );
});
