# WordPress integration

The chatbot is delivered to the college WordPress site as one site-wide
script tag. WordPress core is never modified.

## What is installed

Copy `sfc-chatbot.php` into `wp-content/mu-plugins/` (must-use plugins load
automatically and cannot be deactivated from the admin UI). Alternatively
place it in `wp-content/plugins/` and activate it.

The plugin enqueues the widget script exactly once on every public page via
`wp_enqueue_script`, in the footer:

```html
<script src="https://chatbot.example-college.edu/widget/v1.js"></script>
```

The script carries its own styles and configuration-free boot: it derives the
API base URL from its own `src`, so no keys, tokens, or service credentials
appear in the page. Staff-only secrets never reach WordPress.

## Changing the deployment URL

The URL is filterable for staging/production differences:

```php
add_filter('sfc_chatbot_widget_url', fn() => 'https://chatbot-staging.example-college.edu/widget/v1.js');
```

## Local smoke test

Without a WordPress installation, `public/demo/wordpress-test-page.html`
reproduces the exact script embed. With the chatbot running
(`npm run dev`), open
`http://localhost:3000/demo/wordpress-test-page.html` and use the chat.
The automated smoke check lives at `tests/embed-smoke.test.ts`.
