// The example app's look: its colours, type, spacing, cards, rows, chips,
// buttons, side menu, sheets and the rest, copied unchanged from the style
// block of reference/example-app/src.html (its film's rules left out), and
// its icons and wordmark from the same file and logo-paths.txt. The screens
// themselves are written again to read the record.
//
// After the example's rules come a few of Front-line's own, for what the
// example draws with buttons and the screens here draw with links and forms.

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
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
svg{display:block}
p,li,span{text-wrap:pretty}
:focus{outline:none}
:focus-visible{outline:3px solid var(--teal);outline-offset:2px;border-radius:8px}
h1:focus-visible{outline:none}
.sprite{position:absolute;width:0;height:0;overflow:hidden}
.i{width:20px;height:20px;flex:none}
.i-16{width:16px;height:16px;flex:none}
.sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* Shell */
.app{display:flex;flex-direction:column}
.app[data-bar="send"]{--bar:80px}
.app[data-bar="actions"]{--bar:146px}
.side{display:none}
.main{min-width:0;padding-inline:16px;padding-bottom:calc(var(--bar) + 28px + env(safe-area-inset-bottom,0px))}
.screen{max-width:720px;margin-inline:auto;display:flex;flex-direction:column;gap:18px;padding-block:4px 8px}

/* Type */
h1{font-size:26px;line-height:1.12;letter-spacing:-.025em;font-weight:740}
h2{font-size:19px;line-height:1.25;letter-spacing:-.01em;font-weight:700}
.meta{color:var(--ink-2)}
.badge{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:var(--teal);border-radius:999px;padding:4px 9px}

/* Top of Home on a phone */
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px}
.top-acts{display:flex;gap:8px}
.logo{width:96px;height:19px;flex:none}
.hello{display:flex;flex-direction:column;gap:2px}
.firm{display:flex;align-items:center;gap:10px;flex-wrap:wrap}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 16px;border:0;border-radius:10px;font-weight:600;font-size:16px;line-height:1.1;text-decoration:none;white-space:nowrap}
.btn-ink{background:var(--ink);color:var(--cream)}
.btn-ink:hover{background:#151A2C}
.btn-teal{background:var(--teal);color:#fff}
.btn-teal:hover{background:#246A70}
.btn-line{background:transparent;border:1.5px solid var(--line-strong)}
.btn-line:hover{background:rgba(32,39,62,.05)}
.btn-lg{min-height:56px;font-size:18px;border-radius:12px}
.btn-sm{padding:0 12px;gap:6px}
.btn-block{width:100%}
.link{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0;border:0;background:none;font-weight:600;text-decoration:underline;text-underline-offset:3px;text-align:left}
.back{display:inline-flex;align-items:center;gap:4px;min-height:44px;padding:0 10px 0 0;border:0;background:none;font-weight:600;align-self:flex-start}
.find{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;padding:0 14px;border:1.5px solid var(--line-strong);border-radius:12px;background:var(--card);color:var(--ink-2);text-align:left}
input.find{color:var(--ink)}
input.find::placeholder{color:var(--ink-2);opacity:1}

/* Blocks, cards and rows */
.block{display:flex;flex-direction:column;gap:8px}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:30px}
.head .link{margin-block:-7px}
.count{color:var(--ink-2);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.row{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:10px 14px;border:0;background:none;text-align:left}
.row + .row{border-top:1px solid var(--line)}
button.row:hover{background:rgba(32,39,62,.035)}
button.row:focus-visible{outline-offset:-3px;border-radius:12px}
.txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.t1{font-weight:600}
.t2{color:var(--ink-2)}
.tile{width:40px;height:40px;border-radius:11px;background:var(--teal-tint);color:var(--teal);display:flex;align-items:center;justify-content:center;flex:none}
.tile svg{width:25px;height:25px}
.chev{color:var(--ink-2)}
.empty{padding:16px 14px;color:var(--ink-2)}
.pad{padding:14px}
.stack{display:flex;flex-direction:column;gap:10px}

/* Status chips: a word, a colour and an icon together */
.chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 7px;border-radius:999px;font-size:15px;font-weight:600;line-height:20px;white-space:nowrap;align-self:flex-start}
.chip-ok{background:var(--peach-tint)}
.chip-good{background:var(--teal-tint)}
.chip-good .i-16{color:var(--teal)}
.chip-plain{background:var(--cream-deep)}
.chip-bad{background:var(--error-tint);color:var(--error)}

/* Done for you */
.feed{display:flex;flex-direction:column}
.feed li + li{border-top:1px solid var(--line)}
.fb{display:flex;align-items:flex-start;gap:10px;width:100%;min-height:44px;padding:8px 0;border:0;background:none;text-align:left}
button.fb:hover .ft{text-decoration:underline;text-underline-offset:3px}
.fb .tick{color:var(--teal);margin-top:1px}
.ft{flex:1;min-width:0}
.fb time{color:var(--ink-2);font-variant-numeric:tabular-nums;flex:none}

/* Money */
.money{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.fig{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:12px;background:var(--cream-deep)}
.fig b{font-size:21px;line-height:1.2;font-weight:740;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.fig.bad b{color:var(--error)}
.kv li{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:12px 14px}
.kv li + li{border-top:1px solid var(--line)}
.kv b{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}

/* Review */
.total{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.total b{font-size:40px;line-height:1.05;font-weight:740;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.ticks{display:flex;flex-direction:column;gap:6px}
.ticks li{display:flex;gap:10px;align-items:flex-start}
.ticks .i{color:var(--teal);margin-top:1px}
.flag{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;background:var(--peach-tint)}
.flag .i{margin-top:1px}
.quote{padding:12px 14px;border-radius:12px;background:var(--cream-deep)}

/* Job timeline */
.day{font-weight:700;padding:14px 14px 2px}
.tl li{display:flex;flex-direction:column;gap:6px;padding:10px 14px}
.tl li + li{border-top:1px solid var(--line)}
.tl-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.tl-top time{color:var(--ink-2);font-variant-numeric:tabular-nums}
.who{display:inline-flex;padding:2px 9px;border-radius:999px;font-size:15px;font-weight:600;line-height:20px}
.who-fl{background:var(--teal-tint)}
.who-you{background:var(--peach-tint)}
.who-cust{background:var(--cream-deep)}

/* Bottom bar and toast */
.bar{position:fixed;left:0;right:0;bottom:0;z-index:20;padding:10px 16px calc(12px + env(safe-area-inset-bottom,0px));background:var(--cream);border-top:1px solid var(--line)}
.bar-in{max-width:720px;margin-inline:auto;display:flex;flex-direction:column;gap:8px}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.toast{position:fixed;left:calc(var(--side) + 16px);right:16px;bottom:calc(var(--bar) + 12px + env(safe-area-inset-bottom,0px));z-index:30;display:flex;justify-content:center;pointer-events:none}
.toast-in{pointer-events:auto;display:flex;align-items:center;gap:10px;max-width:520px;padding:8px 8px 8px 16px;border-radius:12px;background:var(--ink);color:var(--cream);box-shadow:0 8px 24px rgba(16,22,42,.25)}
.toast-in span{flex:1;min-width:0;padding-block:6px}
.toast-btn{min-height:44px;padding:0 14px;border-radius:9px;border:1.5px solid rgba(251,244,235,.55);background:none;color:var(--cream);font-weight:600;white-space:nowrap}

/* Sheets */
.sheet-wrap{position:fixed;inset:0;z-index:50;display:flex;align-items:flex-end;justify-content:center;background:rgba(16,22,42,.5)}
.sheet{width:100%;max-width:560px;max-height:calc(100% - 40px);overflow:auto;display:flex;flex-direction:column;gap:16px;padding:10px 16px calc(20px + env(safe-area-inset-bottom,0px));border-radius:18px 18px 0 0;background:var(--cream);animation:rise .18s ease-out}
.sheet-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.x{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;margin-right:-10px;border:0;border-radius:10px;background:none}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-weight:600}
.field input,.field textarea{width:100%;min-height:48px;padding:10px 12px;border:1.5px solid var(--line-strong);border-radius:10px;background:var(--card)}
.field textarea{min-height:110px;resize:vertical}
.rec{display:flex;align-items:center;justify-content:center;gap:5px;height:60px}
.rec i{display:block;width:5px;height:14px;border-radius:3px;background:var(--teal);animation:pulse 1s ease-in-out infinite}
.rec i:nth-child(3n){animation-delay:.2s}
.rec i:nth-child(3n+1){animation-delay:.45s}
.timer{font-size:34px;font-weight:740;letter-spacing:-.02em;font-variant-numeric:tabular-nums;text-align:center}
.center{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}
.bigtick{width:56px;height:56px;border-radius:50%;background:var(--teal-tint);color:var(--teal);display:flex;align-items:center;justify-content:center}
.bigtick svg{width:30px;height:30px}
.bubble{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:16px 16px 16px 4px;background:var(--card)}
.mini{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--cream)}
.mini .btn{pointer-events:none}
@keyframes rise{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
@keyframes pulse{0%,100%{height:12px}50%{height:46px}}
@media (prefers-reduced-motion:reduce){.sheet{animation:none}.rec i{animation:none;height:28px}}

/* Laptop */
@media (min-width:960px){
  .app{--side:296px;flex-direction:row;align-items:flex-start}
  .app[data-bar="send"]{--bar:0px}
  .app .side{display:flex;flex-direction:column;gap:4px;flex:none;width:var(--side);position:sticky;top:0;height:100vh;overflow:auto;padding:22px 16px;background:var(--cream-deep);border-right:1px solid var(--line)}
  .app .side-brand{display:flex;flex-direction:column;gap:12px;padding:0 10px 14px}
  .app .side .logo{width:112px;height:22px}
  .app .side-firm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700}
  .app .nav{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:0 10px;border:1.5px solid transparent;border-radius:10px;background:none;text-align:left}
  .app .nav:hover{background:rgba(32,39,62,.05)}
  .app .nav[aria-current="page"]{background:var(--card);border-color:var(--line-strong);font-weight:700}
  .app .nav .i{color:var(--teal);width:22px;height:22px}
  .app .nav span{flex:1;min-width:0}
  .app .nav b{flex:none;min-width:24px;padding:0 7px;border-radius:12px;background:var(--ink);color:var(--cream);font-size:15px;font-weight:700;line-height:24px;text-align:center}
  .app .side hr{width:calc(100% - 20px);margin:8px 10px;border:0;border-top:1px solid var(--line)}
  .app .side-end{margin-top:auto;padding-top:16px;display:flex;flex-direction:column;gap:8px}
  .app .main{flex:1;padding:26px 40px 40px;padding-bottom:calc(var(--bar) + 40px)}
  .app .screen{margin-inline:0;max-width:760px;gap:24px}
  .app .screen.wide{max-width:1040px}
  .app .top,.app .only-phone{display:none}
  .app .home-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:28px;align-items:start}
  .app .home-grid > div{display:flex;flex-direction:column;gap:24px}
  .app .money{grid-template-columns:minmax(0,1fr)}
  .app .fig{flex-direction:row;align-items:baseline;justify-content:space-between;padding:14px 16px}
  .app[data-bar="send"] .bar{display:none}
  .app .bar{left:var(--side);padding-inline:40px}
  .app .bar-in{margin-inline:0;max-width:760px;flex-direction:row}
  .app .bar-in > .btn{flex:1}
  .app .bar-in .two{flex:1}
  .app .sheet-wrap{align-items:center}
  .app .sheet{border-radius:18px;padding:14px 22px 22px}
}
@media (max-width:959px){
  .home-grid,.home-grid > div{display:contents}
}

/* Not from the example. The screens here are drawn on the server, so a row,
   a menu item or a line in Done for you that opens another screen is a link,
   and an action is a form. They look as the example's buttons do. */
a{color:inherit}
a.row,a.nav,a.fb,a.back,a.btn,a.x{text-decoration:none}
a.row:hover{background:rgba(32,39,62,.035)}
a.row:focus-visible{outline-offset:-3px;border-radius:12px}
a.fb:hover .ft{text-decoration:underline;text-underline-offset:3px}
form{margin:0}
[hidden]{display:none!important}
.btn[aria-disabled="true"]{opacity:.75;cursor:progress}
.problem{color:var(--error);font-weight:600}
.tl-bad > span{color:var(--error)}
/* The space a Back button takes at the top of a screen, on the customer's
   pages, which have none. */
.top-gap{min-height:44px}
`;

/** The example's icons and the Front-line wordmark, from its sprite. */
export const ICONS = `
<svg class="sprite" aria-hidden="true" focusable="false">
  <defs>
    <mask id="m-calls" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#fff"></rect><rect x="18.6" y="18.9" width="12.8" height="12.4" rx="3" fill="#000"></rect></mask>
  </defs>
  <symbol id="logo" viewBox="0 0 1167.2 229.9"><path fill="#20273E" fill-rule="evenodd" d="M303.5 226.5C321.4 223.9 339.4 212.6 349.6 197.6C357.1 186.7 360.9 175.8 362.5 160.4C363.6 149.1 361.3 132.9 357.0 122.5C355.0 117.7 347.8 106.6 343.9 102.1C339.0 96.6 329.5 89.8 321.5 86.1C316.6 83.9 306.4 81.1 299.8 80.3C291.2 79.2 279.1 79.9 272.2 81.8C243.6 89.6 225.6 108.0 218.6 136.8C217.6 141.1 217.4 143.7 217.1 151.5C216.9 161.6 217.4 166.5 219.9 176.3C221.4 181.8 225.4 190.5 229.3 196.4C235.1 205.2 246.0 215.0 255.2 219.6C259.0 221.5 270.2 225.4 274.2 226.2C281.9 227.9 293.2 227.9 303.5 226.5ZM1116.0 226.5C1124.7 225.2 1136.6 220.6 1143.2 215.9C1150.3 210.9 1159.0 202.5 1159.0 200.6C1159.0 200.2 1157.6 198.9 1155.9 197.5C1154.2 196.2 1150.2 192.7 1146.9 189.7C1143.7 186.7 1140.9 184.2 1140.7 184.2C1140.5 184.2 1138.2 186.1 1135.8 188.5C1127.0 196.9 1119.8 200.2 1107.8 201.9C1100.5 202.9 1090.3 201.0 1083.2 197.4C1077.0 194.2 1068.5 184.6 1066.0 177.9C1064.3 173.5 1063.0 167.8 1063.0 165.2L1063.0 162.9L1070.9 162.6C1075.2 162.4 1097.8 162.3 1121.2 162.4L1163.7 162.4L1164.5 160.4C1165.0 159.1 1165.2 156.4 1165.2 151.0C1165.2 134.2 1161.0 119.7 1152.2 106.4C1146.8 98.4 1138.0 90.4 1129.7 86.3C1124.8 83.9 1114.7 81.0 1108.5 80.2C1100.8 79.2 1090.4 79.9 1083.5 81.7C1069.8 85.2 1061.2 90.1 1052.1 99.4C1046.7 104.9 1045.0 107.1 1041.0 114.2C1037.5 120.5 1036.0 124.5 1034.0 132.2C1032.0 140.1 1031.4 145.3 1031.5 153.1C1031.5 164.6 1033.0 173.4 1036.3 182.5C1039.2 190.0 1040.4 192.5 1044.1 197.8C1051.7 209.0 1063.5 218.5 1075.5 223.0C1079.8 224.6 1088.5 226.7 1093.3 227.2C1098.3 227.8 1109.2 227.5 1116.0 226.5ZM589.0 226.8C591.9 226.5 595.6 225.9 597.4 225.5C601.4 224.5 610.1 221.3 610.6 220.5C611.0 219.9 611.0 196.0 610.5 195.2C610.2 194.8 609.8 194.9 608.6 195.5C601.8 199.0 592.3 200.2 586.1 198.5C582.6 197.4 579.0 194.2 577.5 190.6L576.2 188.0L576.2 149.2C576.2 127.9 576.4 109.6 576.5 108.6L576.6 106.8L597.0 106.8L617.5 106.8L617.5 95.0L617.5 83.2L597.0 83.2L576.5 83.2L576.4 62.6C576.2 38.6 577.1 40.9 569.0 44.5C561.8 47.7 555.0 50.1 550.2 51.2L546.2 52.1L546.1 67.6L546.0 83.2L532.0 83.2L518.0 83.2L518.0 95.0L518.0 106.8L532.0 106.8L546.0 106.8L546.1 152.6C546.3 194.8 546.4 198.8 547.2 201.5C550.2 211.6 555.5 218.0 564.5 222.5C569.7 225.1 576.8 226.9 582.5 227.2C583.3 227.2 586.2 227.0 589.0 226.8ZM862.0 154.0L862.0 83.2L847.0 83.2L832.0 83.2L832.0 154.0L832.0 224.8L847.0 224.8L862.0 224.8L862.0 154.0ZM61.9 223.5C61.9 223.5 62.0 197.1 62.0 165.1L62.0 106.8L84.0 106.8L106.0 106.8L106.0 95.0L106.0 83.2L84.0 83.2L61.9 83.2L62.2 79.4C62.4 77.2 62.6 74.1 62.8 72.4C63.1 67.8 65.2 61.1 68.2 55.0C73.9 43.5 84.0 35.4 97.2 31.6C102.2 30.1 111.1 28.8 115.9 28.8C119.3 28.8 128.1 29.9 132.1 30.7C133.2 31.0 134.4 31.1 134.6 30.9C135.2 30.6 135.1 4.4 134.5 4.0C133.3 3.2 120.6 2.2 112.5 2.2C103.4 2.2 96.9 3.0 87.8 5.2C77.2 7.8 66.1 13.2 57.7 19.9C45.4 29.9 37.4 42.3 33.2 58.2C31.8 63.9 30.5 73.4 30.5 79.1L30.5 83.2L16.2 83.2L2.0 83.2L2.0 95.0L2.0 106.8L16.0 106.8L30.0 106.8L30.1 111.9C30.1 114.7 30.1 140.9 30.0 170.1C29.9 199.4 30.1 223.4 30.2 223.6C30.4 224.0 61.4 224.0 61.9 223.5ZM160.1 186.6C160.3 151.4 160.4 149.2 161.4 145.0C162.9 138.0 165.2 132.0 167.7 128.2C172.6 120.8 180.3 115.0 188.1 112.9C191.5 111.9 201.8 111.6 207.1 112.4L210.0 112.8L210.0 97.5L210.0 82.2L208.6 81.7C207.9 81.4 204.6 81.1 201.5 81.1C192.6 81.1 184.8 83.4 177.8 88.1C175.9 89.4 173.1 91.6 171.7 93.1C169.4 95.4 164.8 101.9 162.4 106.2C161.9 107.1 161.2 107.8 160.8 107.8C160.1 107.8 160.0 106.3 160.0 95.7C160.1 89.1 159.9 83.5 159.8 83.3C159.6 83.1 152.8 83.1 144.6 83.1L129.8 83.2L129.7 153.1C129.6 201.5 129.8 223.2 130.2 223.7C130.6 224.2 133.4 224.3 145.2 224.1L159.8 223.9L160.1 186.6ZM413.8 223.6C414.0 223.5 414.1 203.6 414.1 179.5C414.2 135.8 414.2 135.4 415.4 131.6C417.5 124.1 422.4 116.4 427.3 112.9C433.8 108.3 444.9 106.4 453.6 108.4C462.0 110.4 468.8 116.4 472.0 124.6C475.0 132.8 475.0 131.9 475.0 180.0C475.0 204.0 475.2 223.8 475.4 224.0C475.6 224.1 482.5 224.0 490.6 223.9L505.5 223.6L505.5 176.8C505.5 150.8 505.2 127.8 505.0 125.1C502.4 98.1 485.0 81.1 458.8 79.9C448.8 79.4 443.2 80.6 434.2 85.0C427.3 88.4 419.0 95.6 416.2 100.9C415.8 101.6 415.1 102.2 414.8 102.2C414.1 102.2 414.0 100.6 413.9 92.6L413.8 83.0L399.1 83.1C391.1 83.1 384.3 83.3 384.0 83.5C383.2 84.0 383.3 223.6 384.1 223.9C384.9 224.2 413.5 223.9 413.8 223.6ZM815.5 219.2C815.7 216.6 815.8 211.0 815.7 206.8C815.5 202.5 815.5 198.8 815.5 198.4C815.5 198.1 814.4 197.7 813.0 197.5C810.3 197.1 805.3 195.0 802.8 193.0C800.8 191.5 798.6 187.5 796.9 182.5L795.8 179.0L795.5 98.5L795.2 18.0L793.9 15.1C791.5 9.9 786.2 5.4 780.2 3.2C777.9 2.4 776.0 2.1 771.2 2.1L765.2 2.0L765.3 92.0C765.3 175.2 765.4 182.3 766.2 186.2C768.2 195.9 772.2 204.3 777.2 209.7C785.6 218.5 795.3 223.0 807.5 223.8C811.0 224.0 814.1 224.1 814.5 224.0C815.1 224.0 815.3 223.0 815.5 219.2ZM920.0 223.5C920.1 223.3 920.2 203.7 920.3 179.9C920.4 131.3 920.3 132.4 924.0 125.1C928.8 115.2 935.2 110.4 946.1 108.1C950.5 107.3 951.7 107.2 955.8 107.7C958.4 108.0 961.7 108.7 963.2 109.2C971.2 112.2 977.3 118.9 979.7 127.2C981.4 133.1 981.5 135.6 981.5 179.2C981.5 212.6 981.7 223.3 982.2 223.6C982.5 224.0 988.6 224.0 997.2 224.0L1011.8 223.9L1011.8 173.4C1011.8 127.6 1011.7 122.6 1010.9 119.2C1009.5 113.1 1007.5 106.9 1006.2 104.3C1002.7 97.1 993.8 88.1 987.2 85.0C980.3 81.7 971.5 79.8 963.2 79.8C953.5 79.8 944.3 82.4 937.0 87.1C932.4 90.1 925.0 97.2 922.8 100.7C920.5 104.2 920.3 103.4 920.2 93.2C920.0 88.1 919.9 83.7 919.8 83.4C919.6 82.9 916.3 82.9 905.4 83.1C897.6 83.2 891.0 83.4 890.6 83.5C890.2 83.7 890.0 98.1 890.0 153.6C890.0 192.1 890.2 223.8 890.4 224.0C890.8 224.4 919.5 223.9 920.0 223.5ZM281.2 199.9C264.7 195.5 253.6 184.0 249.7 166.9C247.9 158.9 247.6 152.4 248.9 144.9C251.9 127.8 261.0 115.3 274.8 109.6C283.5 105.9 295.5 105.8 304.5 109.2C310.5 111.5 319.5 118.2 322.6 122.8C325.0 126.3 328.3 133.2 329.5 137.0C331.0 142.1 332.5 152.9 332.2 156.5C331.7 161.8 329.5 171.2 327.8 175.2C323.0 186.5 313.5 195.4 302.2 199.1C296.9 200.9 286.5 201.2 281.2 199.9ZM1063.3 141.4C1062.3 140.4 1064.2 132.2 1066.8 126.8C1070.2 119.6 1076.5 112.4 1082.4 109.4C1088.3 106.2 1091.5 105.5 1099.5 105.6C1106.0 105.6 1107.2 105.7 1110.7 106.9C1121.0 110.5 1128.2 118.3 1132.2 130.4C1133.8 135.1 1134.6 140.2 1133.9 141.1C1133.5 141.6 1125.8 141.8 1098.5 141.8C1079.3 141.8 1063.5 141.6 1063.3 141.4ZM853.6 65.1C857.2 63.5 860.2 60.4 862.0 56.8C863.0 54.5 863.2 53.3 863.2 50.0C863.2 45.1 861.8 41.6 858.5 38.2C855.2 34.9 851.6 33.5 846.8 33.5C843.5 33.5 842.2 33.8 840.0 34.8C832.5 38.3 828.5 46.8 830.7 54.4C833.6 64.3 844.3 69.4 853.6 65.1Z"></path>
<path fill="#2B7E85" d="M734.2 148.1C734.7 146.4 734.5 126.1 734.0 125.3C733.7 124.7 725.8 124.6 683.8 124.7C656.4 124.7 633.8 124.8 633.5 125.0C632.9 125.3 632.8 148.4 633.3 148.9C633.5 149.1 656.2 149.2 683.8 149.2L733.9 149.2L734.2 148.1Z"></path></symbol>
  <symbol id="i-calls" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path mask="url(#m-calls)" d="M7.1 4.8h3.1l1.7 4.4-2.3 1.6a13.6 13.6 0 0 0 5.9 5.9l1.6-2.3 4.4 1.7v3.1a2 2 0 0 1-2.2 2A17.2 17.2 0 0 1 5.1 7a2 2 0 0 1 2-2.2z"></path><path d="M15.4 4.4a9.2 9.2 0 0 1 7.7 7.7M15.2 8.2a5.3 5.3 0 0 1 4.1 4.1"></path><rect x="20.4" y="21.2" width="9.2" height="8.1" rx="1.6"></rect><path d="M23 19.7v2.8M27 19.7v2.8M22.9 25.6l1.5 1.4 2.8-2.9"></path></symbol>
  <symbol id="i-quote" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.6v6.3c0 .6.2 1.1.6 1.5l12.4 12.4a2.1 2.1 0 0 0 3 0l6.3-6.3a2.1 2.1 0 0 0 0-3L14.4 5.1a2.1 2.1 0 0 0-1.5-.6H6.6a2.1 2.1 0 0 0-2.1 2.1z"></path><circle cx="9.4" cy="9.4" r="1.6"></circle><path d="M20.3 13.3a2.3 2.3 0 0 0-4 1.6v4.3c0 .9-.4 1.6-1.2 2.1h5.7M14.9 17.4h3.9"></path></symbol>
  <symbol id="i-followup" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7.2 6h17.6a2.7 2.7 0 0 1 2.7 2.7v10.1a2.7 2.7 0 0 1-2.7 2.7H13.6l-5.4 4.3v-4.3h-1a2.7 2.7 0 0 1-2.7-2.7V8.7A2.7 2.7 0 0 1 7.2 6z"></path><path d="M10.4 13.8h10.4M17.3 10.3l3.5 3.5-3.5 3.5"></path></symbol>
  <symbol id="i-paperwork" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 5.7H9A2.5 2.5 0 0 0 6.5 8.2v17.8A2.5 2.5 0 0 0 9 28.5h14a2.5 2.5 0 0 0 2.5-2.5V8.2A2.5 2.5 0 0 0 23 5.7h-2.5"></path><rect x="11.5" y="3.5" width="9" height="4.6" rx="1.3"></rect><path d="M10.6 13.4l1.3 1.3 2.3-2.4M16.7 13.7h5.2M10.6 18.8l1.3 1.3 2.3-2.4M16.7 19.1h5.2M10.6 24.1l1.3 1.3 2.3-2.4M16.7 24.4h5.2"></path></symbol>
  <symbol id="i-invoice" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5h17v24l-2.8-1.9-2.9 1.9-2.8-1.9-2.8 1.9-2.9-1.9-2.8 1.9z"></path><path d="M18.4 8.4a2 2 0 0 0-3.5 1.4v3.5c0 .8-.3 1.3-1 1.8h4.8M13.9 11.8h3.5"></path><path d="M11.5 19.2h9M11.5 22.7h6"></path></symbol>
  <symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l4.5 4.5L19.5 7"></path></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></symbol>
  <symbol id="i-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></symbol>
  <symbol id="i-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"></path></symbol>
  <symbol id="i-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3"></path></symbol>
  <symbol id="i-camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"></path><circle cx="12" cy="12.5" r="3.2"></circle></symbol>
  <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5v5M12 16.2v.3"></path></symbol>
  <symbol id="i-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></symbol>
  <symbol id="i-msg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8.5L6 21v-3.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"></path></symbol>
  <symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-6.5 8 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"></path><path d="M9.5 20.5v-6h5v6"></path></symbol>
  <symbol id="i-list" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"></path></symbol>
  <symbol id="i-rules" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h8M17.5 7h2M4.5 12h2M11.5 12h8M4.5 17h9M18.5 17h1"></path><circle cx="15" cy="7" r="2.3"></circle><circle cx="9" cy="12" r="2.3"></circle><circle cx="16" cy="17" r="2.3"></circle></symbol>
  <symbol id="i-pound" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M14.8 9.4a2.4 2.4 0 0 0-4.6.9v2.2c0 1-.4 1.8-1.2 2.5h5.8M9.3 12.6h4"></path></symbol>
  <symbol id="i-play" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M10.2 8.6v6.8l5.4-3.4z"></path></symbol>
  <symbol id="i-cal" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"></rect><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"></path></symbol>
</svg>`;
