// The example app's look: its colours, type, spacing, cards, rows and chips,
// copied from the style block of reference/example-app/src.html. Only the
// rules the screens here use are taken, unchanged. The screens themselves are
// written again to read the record.
//
// The example's side menu and bottom bar are not here yet. They lead to the
// owner's other screens, which come with slice F.

export const LOOK = `
:root{
  --cream:#FBF4EB; --cream-deep:#F5ECE1; --card:#FFFDF9;
  --ink:#20273E; --ink-2:#4A4F63;
  --line:rgba(32,39,62,.12); --line-strong:rgba(32,39,62,.26);
  --teal:#2B7E85; --teal-tint:#E4EFEC;
  --peach-tint:#FFE6D7; --error:#B42318; --error-tint:#FCEDEB;
  --font:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;
  --bar:0px; --side:0px;
  color-scheme:light;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--ink);font-family:var(--font);font-size:16px;line-height:1.4;-webkit-font-smoothing:antialiased}
h1,h2,h3,p,ul,ol{margin:0}
ul,ol{padding:0;list-style:none}
svg{display:block}
p,li,span{text-wrap:pretty}
:focus{outline:none}
:focus-visible{outline:3px solid var(--teal);outline-offset:2px;border-radius:8px}
.sprite{position:absolute;width:0;height:0;overflow:hidden}
.i-16{width:16px;height:16px;flex:none}

/* Shell */
.app{display:flex;flex-direction:column}
.main{min-width:0;padding-inline:16px;padding-bottom:calc(var(--bar) + 28px + env(safe-area-inset-bottom,0px))}
.screen{max-width:720px;margin-inline:auto;display:flex;flex-direction:column;gap:18px;padding-block:4px 8px}

/* Not from the example: the space its Back button takes at the top of a
   screen, kept until slice F brings the button and the screen it goes back to. */
.top-gap{min-height:44px}

/* Type */
h1{font-size:26px;line-height:1.12;letter-spacing:-.025em;font-weight:740}
h2{font-size:19px;line-height:1.25;letter-spacing:-.01em;font-weight:700}
.meta{color:var(--ink-2)}

/* Blocks, cards and rows */
.block{display:flex;flex-direction:column;gap:8px}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:30px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.row{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:10px 14px;border:0;background:none;text-align:left}
.row + .row{border-top:1px solid var(--line)}
.txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.t1{font-weight:600}
.t2{color:var(--ink-2)}

/* Status chips: a word, a colour and an icon together */
.chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 7px;border-radius:999px;font-size:15px;font-weight:600;line-height:20px;white-space:nowrap;align-self:flex-start}
.chip-ok{background:var(--peach-tint)}
.chip-good{background:var(--teal-tint)}
.chip-good .i-16{color:var(--teal)}
.chip-plain{background:var(--cream-deep)}
.chip-bad{background:var(--error-tint);color:var(--error)}

/* Laptop */
@media (min-width:960px){
  .app{flex-direction:row;align-items:flex-start}
  .main{flex:1;padding:26px 40px 40px;padding-bottom:calc(var(--bar) + 40px)}
  .screen{margin-inline:0;max-width:760px;gap:24px}
}
`;

/** The example's icons that the screens here use, from its sprite. */
export const ICONS = `
<svg class="sprite" aria-hidden="true" focusable="false">
  <symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5v5M12 16.2v.3"></path></symbol>
  <symbol id="i-cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"></rect><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"></path></symbol>
</svg>`;
