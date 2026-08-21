const fs = require('fs');
let css = fs.readFileSync('public/css/style-pro.css', 'utf8');

// replace .modern-salon and friends
css = css.replace(/\.modern-salon \{.*?\}/s, `
.modern-salon {
    background: linear-gradient(135deg, rgba(10, 30, 20, 0.95), rgba(5, 15, 10, 0.95)) !important;
    border: 2px solid var(--gold-soft) !important;
    border-radius: 24px !important;
    padding: 30px !important;
    box-shadow: 0 20px 60px rgba(0,0,0,0.9), inset 0 0 20px rgba(242,197,22,0.1) !important;
    backdrop-filter: blur(15px);
    max-width: 95vw;
    width: 800px;
    max-height: 90vh !important;
    overflow-y: auto !important;
    display: flex;
    flex-direction: column;
    align-items: stretch;
}
`);
css = css.replace(/\.modern-salon h2 \{.*?\}/s, `
.modern-salon h2 {
    color: var(--gold);
    font-size: 32px;
    text-align: center;
    margin-bottom: 30px;
    text-transform: uppercase;
    letter-spacing: 2px;
    border-bottom: 1px solid rgba(242,197,22,0.3);
    padding-bottom: 15px;
    text-shadow: 0 2px 5px rgba(0,0,0,0.5);
}
`);

const extra_css = `
.salon-layout-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    align-items: stretch;
}
.modern-salon .grille-sieges {
    display: grid !important;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
}
.modern-salon .chat-container {
    height: 100% !important;
    min-height: 200px;
    margin: 0 !important;
}
.modern-salon .salon-actions {
    display: grid !important;
    grid-template-columns: 1fr 1.5fr 1fr;
    gap: 15px;
    margin-top: 30px;
}
.modern-salon .btn-large {
    font-size: 16px !important;
    padding: 12px 20px !important;
}
@media (max-width: 768px) {
    .salon-layout-grid {
        grid-template-columns: 1fr;
    }
    .modern-salon .salon-actions {
        grid-template-columns: 1fr;
    }
}
`;
if (!css.includes('.salon-layout-grid')) {
    css += extra_css;
}

fs.writeFileSync('public/css/style-pro.css', css);
console.log("CSS updated");
