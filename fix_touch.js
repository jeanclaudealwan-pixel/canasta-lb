const fs = require('fs');
let css = fs.readFileSync('public/css/style-pro.css', 'utf8');

const globalRules = `
/* Améliorations tactiles (Mobile & WebApp) */
* {
    touch-action: manipulation !important;
    -webkit-tap-highlight-color: transparent !important;
}
body {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}
input, textarea, .chat-messages {
    -webkit-user-select: auto;
    user-select: auto;
}
`;

if (!css.includes('touch-action: manipulation')) {
    css = globalRules + '\n' + css;
    fs.writeFileSync('public/css/style-pro.css', css, 'utf8');
    console.log('Added touch-action fixes');
}

// Ensure body has ontouchstart in index.html to enable :active states on iOS
let html = fs.readFileSync('public/index.html', 'utf8');
if (!html.includes('ontouchstart=')) {
    html = html.replace('<body>', '<body ontouchstart="">');
    fs.writeFileSync('public/index.html', html, 'utf8');
    console.log('Added ontouchstart to body');
}
