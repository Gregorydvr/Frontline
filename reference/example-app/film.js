  /* ================= The film, version 2 =================
     One example job played through the app, told in five chapters (one for each service) and
     "after the job". The stage does not move: Tom's phone on the left, the customer's on the right
     and Front-line's column between them, for the whole film. The words are in the middle column
     and nowhere else. Everything on the stage is worked out from one clock, so seek(t) always draws
     the same picture for the same t. That is what lets it be recorded frame by frame, and re-timed
     to a voice by changing the numbers below.
     Version 1 (three close-up framings, a headline that kept changing, a clock) is in the artifact's
     history and in dev/v1/. */
  const Film = (() => {
    const el = document.getElementById('fl-film');
    const FW = 1920, FH = 1080;
    const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
    const eOut = p => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
    const eIO = p => { p = clamp(p, 0, 1); return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
    const eBack = p => { p = clamp(p, 0, 1); const c = 1.5; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
    const mix = (a, b, p) => a + (b - a) * p;
    const bell = p => p <= 0 || p >= 1 ? 0 : Math.sin(Math.PI * p);

    /* ---------- the example firm's other work ----------
       On a real 2026 calendar, so the money figures agree on every day the film visits and match
       the app's own example on 15 October.
       [id, customer, job, quote [amount, sent, accepted, went quiet], invoice [amount, sent, due, paid]] */
    const OTHER = [
      ['khan', 'Mr Khan', 'New boiler', [3080, '09-17 16:10', '09-20 19:12'], [2464, '10-01 09:10', '10-15', '10-14 11:26']],
      ['wood', 'Mr Wood', 'Cylinder replacement', null, [640, '09-24 12:10', '10-08', '10-23 10:05']],
      ['ellis', 'Mr Ellis', 'Three radiators', [1260, '09-25 15:30', '10-02 12:20'], [1008, '10-08 16:00', '10-22', '10-09 09:15']],
      ['ford', 'Mrs Ford', 'Unvented cylinder', [2180, '09-26 10:40', '09-30 08:50'], [1744, '10-26 15:00', '11-09', '10-30 13:00']],
      ['okafor', 'Mr Okafor', 'Bathroom radiator', [480, '10-02 16:45', '10-05 09:30'], [480, '10-07 15:00', '10-21', '10-08 10:00']],
      ['hughes', 'Mr Hughes', 'Radiator swap', [420, '10-08 16:05', '10-09 08:20'], [420, '10-15 16:00', '10-29', '10-20 09:00']],
      ['bell', 'Ms Bell', 'Boiler replacement', [2450, '10-09 15:10', null, '10-17 00:00'], null],
      ['shah', 'Mr Shah', 'Three radiators', [1170, '10-10 11:30', '10-17 09:40'], [936, '10-27 16:00', '11-10', '10-29 11:00']],
      ['lewis', 'Mrs Lewis', 'Boiler replacement', null, [1670, '10-10 10:20', '10-24', '10-21 14:00']],
      ['evans', 'Mr Evans', 'New boiler and two radiators', [2550, '10-12 16:40', '10-15 15:31'], [2040, '10-21 15:00', '11-04', '10-30 09:00']],
      ['kaur', 'Mrs Kaur', 'Boiler replacement', [2960, '10-13 17:05', '10-16 11:00'], [2368, '11-03 16:00', '11-17', null]],
      ['turner', 'Mr Turner', 'Unvented cylinder', [1840, '10-14 16:20', '10-17 10:10'], [1472, '10-28 15:30', '11-11', '11-02 14:10']],
      ['patel', 'Mrs Patel', 'New boiler', [3150, '10-15 16:30', '10-18 12:00'], null],
      ['grant', 'Mr Grant', 'New boiler', [2720, '11-02 09:30', '11-05 18:20'], null],
      ['doyle', 'Mrs Doyle', 'Two radiators', [690, '11-04 15:20', '11-05 08:15'], null],
      ['hill', 'Mr Hill', 'Cylinder replacement', [1480, '11-05 16:45', null], null]
    ];
    /* The week of 2 to 6 November, for the Friday summary. */
    const WEEK = { sent: '3 · £4,890', won: '2 · £3,410', quiet: 'None', paid: '2 · £3,929', deposits: '1 · £544' };
    const stamp = s => { const m = /^(\d\d)-(\d\d)(?: (\d\d):(\d\d))?$/.exec(s); return Date.UTC(2026, +m[1] - 1, +m[2], +(m[3] || 0), +(m[4] || 0)) / 60000; };
    function otherJobs(now) {
      const jobs = {};
      OTHER.forEach(([id, c, t, q, v]) => {
        const j = { c, t, a: '', st: 'booked', next: '', tl: [] };
        if (q && stamp(q[1]) <= now) j.q = { amt: q[0], state: q[2] && stamp(q[2]) <= now ? 'accepted' : q[3] && stamp(q[3]) <= now ? 'quiet' : 'waiting' };
        if (v && stamp(v[1]) <= now) j.inv = { amt: v[0], state: v[3] && stamp(v[3]) <= now ? 'paid' : now >= stamp(v[2]) + 1440 ? 'overdue' : 'sent' };
        if (j.q || j.inv) jobs[id] = j;
      });
      return jobs;
    }
    /* The days the film visits: [date, as the app writes it, as the slate writes it, what else Front-line did that day] */
    const DAYS = {
      d1: ['09-28', 'Monday 28 September', 'Mon 28 Sep', [['09:05', 'ellis', 'Nudged Mr Ellis about his quote (day 3).'], ['08:12', null, 'Call from a supplier. Message taken.']]],
      d1b: ['09-30', 'Wednesday 30 September', 'Wed 30 Sep', [['08:50', 'ford', 'Mrs Ford said yes and paid her deposit. Chasing stopped.']]],
      d2: ['10-01', 'Thursday 1 October', 'Thu 1 Oct', [['09:10', 'khan', 'Sent Mr Khan his invoice for £2,464 after your OK.']]],
      d3: ['10-04', 'Sunday 4 October', 'Sun 4 Oct', []],
      d3b: ['10-14', 'Wednesday 14 October', 'Wed 14 Oct', [['11:26', 'khan', 'Mr Khan paid £2,464. Invoice marked paid.']]],
      d4: ['10-15', 'Thursday 15 October', 'Thu 15 Oct', null],
      d5: ['11-05', 'Thursday 5 November', 'Thu 5 Nov', [['08:15', 'doyle', 'Mrs Doyle said yes to her quote. Chasing stopped.']]],
      d6: ['11-06', 'Friday 6 November', 'Fri 6 Nov', []],
      d7: ['10-01', 'Friday 1 October', 'Fri 1 Oct 2027', []]
    };
    const CALLS = { d1: 2, d1b: 3, d2: 2, d3: 0, d3b: 4, d5: 3, d6: 2 };   /* calls answered by the time the film looks in */
    const h12 = c => { const h = +c.slice(0, 2), m = c.slice(3); return ((h + 11) % 12 + 1) + ':' + m + (h < 12 ? 'am' : 'pm'); };

    /* The data Tom's phone is drawn from, in the app's own shape. */
    function tomData(m) {
      const d = DAYS[m.day];
      const now = stamp(d[0] + ' ' + m.clock);
      const jobs = m.day === 'd7' ? {} : otherJobs(now);
      jobs.ahmed = m.ahmed;
      const other = (d[3] || seed().feed.filter(f => f[0] < '13:48')).filter(f => f[0] <= m.clock);
      return { firm: APP.firm, owner: APP.owner, day: d[1], approvals: m.ok.concat(m.day === 'd4' ? ['i-hughes'] : []), born: m.born,
        filter: m.filter, reportChecked: m.report !== false, fluePhoto: !!m.flue, gasSent: !!m.gas, voiceUsed: false, changeAsked: {},
        feed: m.feed.concat(other), yesterday: [], calls: m.day === 'd4' ? seed().calls : Array(CALLS[m.day] || 0).fill(['', null, '', '', null]), web: [], diary: [], jobs,
        reviews: REVIEWS, week: m.day === 'd6' ? WEEK : null, sheet: m.sheet, find: '' };
    }
    let REVIEWS = {};
    function makeReviews(own, firm) {
      return { 'q-ahmed': { id: 'q-ahmed', kind: 'quote', job: 'ahmed', icon: 'i-quote', title: 'Quote for Mrs Ahmed', what: 'Boiler replacement', total: 2890,
        lines: [['Combi boiler, supplied and fitted', 2450], ['Standard flue and fittings', 180], ['System flush', 260]],
        from: ['Every line is from your price list.', 'Last similar job: Mr Khan, September, £3,080.', 'Her name, address and number came from the call.'],
        withIt: ['A 20% deposit of £578, paid straight to your account.', 'A nudge on day 3 and day 7 if there’s no reply.'],
        msg: `Hi Mrs Ahmed, it’s ${own} from ${firm}. Thanks for having me round today. Here’s your quote for the new boiler: £2,890. You can read it, accept it and pay the deposit from the link.`,
        cta: 'View your quote', pay: ['Accept quote', 'Pay £578 deposit'] } };
    }


    /* ---------- where things sit on the stage ----------
       One arrangement for the whole film: Tom's phone, Front-line's column, the customer's phone.
       "off" is the same with the phones slid out of the picture, for the opening and closing cards.
       t = Tom's phone, c = the customer's (x, y, scale), mx = the middle column, hd = the column
       heads and the map, mo = the middle column. */
    const LAY = {
      off:   { tx: -560, ty: 150, ts: 1.06, cx: 2040, cy: 150, cs: 1.06, mx: 555, hd: 0, mo: 0 },
      stage: { tx: 56, ty: 150, ts: 1.06, cx: 1425, cy: 150, cs: 1.06, mx: 555, hd: 1, mo: 1 }
    };
    const LKEYS = Object.keys(LAY.stage);
    const layAt = (l, t) => { const p = eIO((t - l.t0) / l.dur), o = {}; LKEYS.forEach(k => { o[k] = mix(l.from[k], l.to[k], p); }); return o; };
    const twAt = (w, t) => mix(w.from, w.to, eIO((t - w.t0) / w.dur));
    /* The five chapters are the app's five services, in the order a job meets them. */
    const CHAPS = ['calls', 'quotes', 'followups', 'paperwork', 'invoices'];
    const CARD_UP = 1.0;      /* seconds a chapter card stays fully up after its moment; it is gone .3 s later */
    const DIM = .36;          /* how far a phone is turned down while the other one is the one to watch */
    const BACK = .58;         /* how far a line of the list steps back once the next one has arrived */

    /* ---------- the story ---------- */
    let beats = [], cues = [], snaps = [], cards = [], DUR = 0;

    function build() {
      const OWN = APP.owner, FIRM = APP.firm;
      REVIEWS = makeReviews(OWN, FIRM);
      beats = []; cues = []; cards = [];
      let T = 0;
      const r3 = x => Math.round(x * 1000) / 1000;
      const at = (off, fn) => cues.push([r3(T + off), fn]);
      /* a chapter card: n is 0 to 4 for the five services, 5 for "after the job" */
      const card = (off, n) => { cards.push(n < 5 ? { t: r3(T + off), sub: `${n + 1} of 5`, icon: SVC[CHAPS[n]].icon, title: SVC[CHAPS[n]].label } : { t: r3(T + off), sub: 'And then', icon: '', title: 'After the job' }); };
      const beat = (id, title, dur, say, fn) => { beats.push({ id, title, say: say.map(l => l[1]).join(' '), lines: say.map(l => ({ t0: r3(T + l[0]), text: l[1], dur: l[2] || 0 })), t0: T, t1: r3(T + dur) }); fn(); T = r3(T + dur); };

      /* small moves, each changing the state s at film time t */
      const lay = (s, t, name, dur) => { s.lay = { from: layAt(s.lay, t), to: Object.assign({}, LAY[name]), t0: t, dur: dur || .9 }; };
      const focus = (s, t, who) => { if (s.focus.who !== who) s.focus = { who, was: s.focus.who, t0: t }; };
      const chap = (s, t, n) => { s.chap = { n, t0: t }; };
      const head = (s, t, text) => { s.head = { text, t0: t, was: s.head ? s.head.text : '' }; };
      const wipe = s => { s.items = []; s.old = null; };
      /* a new part of the chapter: the list clears, and the lines that were on it fade away */
      const page = (s, t) => { s.old = { items: s.items, t0: t }; s.items = []; };
      const fl = (s, t, text) => { s.items.push({ who: 'fl', text, t0: t }); s.did.fl++; s.did.flAt = t; };
      /* something Tom does. sub is what he said, shown under the line; it is written out over `typed` seconds from `from` */
      const tomDid = (s, t, text, sub, typed, from) => { s.items.push({ who: 'tom', text, sub: sub || '', t0: t, typed: typed || 0, from: from || t + .15 }); s.did.tom++; s.did.tomAt = t; };
      const note = (s, t, text) => { s.items.push({ who: 'note', text, t0: t }); };
      const clock = (s, t, c) => { s.tom.clock = c; s.cust.clock = c; };
      const day = (s, t, key, c) => { s.tom.day = key; s.tom.feed = []; s.tom.born = {}; clock(s, t, c); };
      const feed = (s, t, text) => { s.tom.feed.unshift([s.tom.clock, 'ahmed', text, t]); };
      const job = (s, patch, entries) => { Object.assign(s.tom.ahmed, patch); (entries || []).forEach(e => s.tom.ahmed.tl.push(e)); };
      const tap = (s, t, who, sel) => { s[who].tap = { sel, t0: t, x: 0, y: 0 }; };
      const go = (s, t, route) => { s.tom.route = route; s.tom.nav = t; s.tom.scroll = { from: 0, to: 0, t0: t, dur: .01 }; s.tom.spot = null; };
      const scr = (s, t, sel, dur) => { s.tom.scroll = { from: null, to: null, sel, t0: t, dur: dur || .8 }; };
      const sheet = (s, t, sh) => { s.tom.sheet = Object.assign({ name: 'send', t0: s.tom.sheet && !s.tom.sheet.shut ? s.tom.sheet.t0 : t }, sh); };
      const shut = (s, t) => { s.tom.sheet = Object.assign({}, s.tom.sheet, { shut: t }); };
      const toast = (s, t, text) => { s.tom.toast = { text, t0: t, dur: 3 }; };
      /* the one thing on Tom's screen to look at: the element sel finds (or the nearest `up` above it) */
      const spot = (s, t, sel, up) => { s.tom.spot = { sel, up: up || '', t0: t, x: 0, y: 0, w: 0, h: 0, inMain: false }; };
      const unspot = s => { s.tom.spot = null; };
      /* what Tom says or sends, the short way: a note that leaves his phone. kind is 'mic', 'cam' or 'cam mic' */
      const vn = (s, t, text, kind, dur, typed, from) => { s.tom.vn = { text, kind: kind || 'mic', t0: t, dur: dur || 2.2, typed: typed || 0, from: from || t + .15 }; };
      const view = (s, t, v, page) => { s.cust.view = v; s.cust.nav = t; s.cust.page = page || null; };
      /* a message to the customer. text is what she gets, in full; short is what the film's small screen shows */
      const msg = (s, t, m) => { s.cust.msgs.push(Object.assign({ t0: t, time: h12(s.cust.clock) }, m)); };
      const said = (s, t, me, text) => { s.cust.call.push({ me, text, t0: t }); };
      const sendBtn = '.bar [data-act="sheet"]';

      beat('intro', 'Here’s an example job', 10.71, [
        [.8, 'Here’s an example job: one new boiler.', 3.06], [5.6, `Watch what ${OWN}, the owner, has to do, and what gets done for him.`, 4.22]], () => {
        at(4.6, (s, t) => { s.card = { name: 'in', out: t }; lay(s, t, 'stage', 1.1); });
        at(5.0, (s, t) => { head(s, t, 'One new boiler.|Who does what?'); });
        at(6.0, (s, t) => { focus(s, t, 'tom'); });
        at(8.5, (s, t) => { focus(s, t, 'mid'); });
        at(9.9, (s, t) => { focus(s, t, 'all'); });
      });

      /* 1 of 5. The call, the confirmation, the reminder; a website enquiry; and the day Tom runs late. */
      beat('calls', SVC.calls.label, 32.24, [
        [.7, 'Mrs Ahmed rings.', 1.32], [2.6, `${OWN}’s on a job, so Front-line answers and books a quote visit.`, 3.66],
        [7.9, 'She gets a confirmation straight away.', 2.01], [10.8, 'A website enquiry is answered within a minute.', 2.6],
        [14.75, 'Mrs Ahmed gets a reminder the day before.', 2.48],
        [18.15, `Anything urgent goes straight to ${OWN}.`, 2.11], [21.75, `On the day, ${OWN}’s running late.`, 1.92],
        [24.15, 'He sends one voice note.', 1.6], [26.45, 'Front-line tells her, moves his diary, and lets her know when he’s on his way.', 4.04]], () => {
        card(0, 0);
        at(0, (s, t) => { chap(s, t, 0); wipe(s); head(s, t, SVC.calls.label); clock(s, t, '11:15'); focus(s, t, 'cust'); });
        at(1, (s, t) => { view(s, t, 'call'); });
        at(4.5, (s, t) => { s.cust.live = t; fl(s, t, 'Call answered'); said(s, t, 0, `${FIRM}. ${OWN}’s on a job, so you’ve got the automated assistant.`); });
        at(5.4, (s, t) => { fl(s, t, 'Her details taken'); said(s, t, 1, 'My boiler keeps cutting out. I think I need a new one.'); });
        at(6.3, (s, t) => { fl(s, t, 'Quote visit booked'); said(s, t, 0, `${OWN} can come and price one on Thursday at 3pm.`);
          feed(s, t, 'Answered Mrs Ahmed’s call. Quote visit booked for Thursday, 3pm.');
          job(s, {}, [['Mon 28 Sep', '11:15', 'fl', 'Answered her call. The boiler keeps cutting out. Quote visit booked for Thursday, 3pm.']]); });
        at(7.7, (s, t) => { clock(s, t, '11:16'); view(s, t, 'thread'); });
        at(8.3, (s, t) => { fl(s, t, 'Confirmation sent'); feed(s, t, 'Sent Mrs Ahmed a confirmation.');
          job(s, {}, [['Mon 28 Sep', '11:16', 'fl', 'Sent her a confirmation.']]);
          msg(s, t, { day: 'Mon 28 Sep', text: `Hi Mrs Ahmed, it’s ${FIRM}. ${OWN} will be with you on Thursday 1 October at 3pm to look at your boiler and price a new one. Need to change it? Just reply here.`,
            short: `${OWN} will be with you on Thursday at 3pm. Need to change it? Just reply here.` }); });
        at(10.6, (s, t) => { page(s, t); focus(s, t, 'tom'); clock(s, t, '14:41');
          s.tom.feed.unshift(['14:41', 'okafor', 'Answered Mr Okafor’s website enquiry in a minute. Visit booked for Wednesday, 10am.', t]); spot(s, t + .3, '.feed li:first-child'); });
        at(11.31, (s, t) => { fl(s, t, 'Website enquiry answered in a minute'); });
        at(12.9, (s, t) => { fl(s, t, 'That visit booked too'); });
        at(15.25, (s, t) => { unspot(s); focus(s, t, 'cust'); });
        at(15.75, (s, t) => { day(s, t, 'd1b', '13:00'); fl(s, t, 'Reminder sent the day before');
          feed(s, t, 'Reminded Mrs Ahmed about tomorrow’s visit.'); job(s, {}, [['Wed 30 Sep', '13:00', 'fl', 'Reminded her about the visit.']]);
          msg(s, t, { day: 'Wed 30 Sep', text: `Reminder: ${OWN}’s visit is tomorrow, Thursday, at 3pm. See you then.`, short: `Reminder: ${OWN}’s visit is tomorrow at 3pm.` }); });
        at(18.55, (s, t) => { note(s, t, `Anything urgent goes straight to ${OWN}.`); focus(s, t, 'all'); });
        at(21.65, (s, t) => { page(s, t); day(s, t, 'd2', '14:45'); focus(s, t, 'tom'); });
        at(22.05, (s, t) => { note(s, t, `On the day, ${OWN}’s running late.`); });
        at(24.15, (s, t) => { tap(s, t, 'tom', sendBtn); });
        at(24.45, (s, t) => { vn(s, t, '“Running 20 minutes late.”', 'mic', 2.0); tomDid(s, t, 'One voice note:', '“Running 20 minutes late.”', 1.0);
          job(s, {}, [['Thu 1 Oct', '14:45', 'you', 'Voice note: “Running 20 minutes late.”']]); });
        at(26.35, (s, t) => { focus(s, t, 'cust'); clock(s, t, '14:46'); });
        at(26.95, (s, t) => { fl(s, t, 'Mrs Ahmed told'); feed(s, t, 'Told Mrs Ahmed you’re running 20 minutes late.');
          msg(s, t, { day: 'Thu 1 Oct', text: `Sorry, ${OWN}’s running about 20 minutes late. He’ll be with you around 3:20pm.` }); });
        at(27.95, (s, t) => { fl(s, t, 'His diary moved'); feed(s, t, 'Moved your 3pm visit to 3:20pm.');
          job(s, {}, [['Thu 1 Oct', '14:46', 'fl', 'Told her you were running 20 minutes late and moved the diary.']]); });
        at(29.75, (s, t) => { clock(s, t, '15:08'); fl(s, t, '“On my way” sent'); feed(s, t, 'Told Mrs Ahmed you’re on your way.');
          job(s, {}, [['Thu 1 Oct', '15:08', 'fl', 'Told her you were on your way.']]);
          msg(s, t, { text: `${OWN}’s on his way. He’ll be with you in about 10 minutes.` }); });
        at(31.05, (s, t) => { focus(s, t, 'all'); });
      });

      /* 2 of 5. The one place the sending is acted out in full: photos, a voice note, then one tap. */
      beat('quotes', SVC.quotes.label, 29.69, [
        [.7, `After the visit, ${OWN} doesn’t write a quote.`, 2.59], [4.2, 'He sends three photos and a thirty-second voice note.', 3.15],
        [10.9, 'Front-line writes the quote from his own price list.', 2.66], [19.55, `Nothing goes out until ${OWN} says so.`, 2.34],
        [23.58, 'One tap, and it’s sent, with a link to pay the deposit straight into his account.', 4.43]], () => {
        card(0, 1);
        at(0, (s, t) => { chap(s, t, 1); wipe(s); head(s, t, SVC.quotes.label); clock(s, t, '16:10'); focus(s, t, 'tom'); });
        at(1.5, (s, t) => { note(s, t, 'After the visit'); });
        at(3.7, (s, t) => { tap(s, t, 'tom', sendBtn); });
        at(4, (s, t) => { sheet(s, t, { step: 'start' }); });
        at(4.7, (s, t) => { tap(s, t, 'tom', '[data-act="send-add"]'); });
        at(5, (s, t) => { sheet(s, t, { step: 'start', photos: true }); tomDid(s, t, 'Three photos and a voice note:', '“New combi, standard flue, system flush.”', 2.0, t + 1.5);
          job(s, {}, [['Thu 1 Oct', '16:10', 'you', 'Sent a 30-second voice note and 3 photos.']]); });
        at(5.9, (s, t) => { tap(s, t, 'tom', '[data-act="send-rec"]'); });
        at(6.2, (s, t) => { sheet(s, t, { step: 'rec', rec: t, rate: 13.5, max: 30 }); });
        at(8.5, (s, t) => { tap(s, t, 'tom', '[data-act="send-stop"]'); });
        at(8.8, (s, t) => { sheet(s, t, { step: 'sent', text: 'This is Mrs Ahmed’s boiler. We’re pricing her quote now.' }); });
        at(10, (s, t) => { shut(s, t); clock(s, t, '16:24'); });
        at(11.4, (s, t) => { fl(s, t, 'Quote written from his price list'); s.tom.ok = ['q-ahmed']; s.tom.born['q-ahmed'] = t; feed(s, t, 'Priced Mrs Ahmed’s quote from your voice note.');
          job(s, { st: 'needs_ok', next: 'Approve the quote and we send it today.', q: { amt: 2890, state: 'draft' } }, [['Thu 1 Oct', '16:24', 'fl', 'Priced the quote from your price list. Ready for your OK.']]);
          spot(s, t + .3, '[data-act="review"][data-id="q-ahmed"]', '.row'); });
        at(13.9, (s, t) => { tap(s, t, 'tom', '[data-act="review"][data-id="q-ahmed"]'); });
        at(14.2, (s, t) => { go(s, t, { name: 'review', id: 'q-ahmed' }); clock(s, t, '17:10'); });
        at(14.7, (s, t) => { fl(s, t, 'His last similar job shown beside it'); scr(s, t, '.ticks', .9); });
        at(16.42, (s, t) => { fl(s, t, 'Her details filled in from the call'); spot(s, t, '.ticks', 'section'); });
        at(19.75, (s, t) => { page(s, t); note(s, t, `Nothing goes out until ${OWN} says so.`); spot(s, t, '[data-act="approve"]'); });
        at(23.78, (s, t) => { tap(s, t, 'tom', '[data-act="approve"]'); });
        at(24.08, (s, t) => { go(s, t, { name: 'home' }); s.tom.ok = []; toast(s, t, 'Quote sent to Mrs Ahmed.'); tomDid(s, t, 'One tap: “Approve and send”');
          feed(s, t, 'Sent Mrs Ahmed the quote for £2,890 after your OK.');
          job(s, { st: 'waiting', next: 'First nudge on Sunday (day 3) if there’s no reply.', q: { amt: 2890, state: 'waiting' } },
            [['Thu 1 Oct', '17:10', 'you', 'Approved the quote.'], ['Thu 1 Oct', '17:10', 'fl', 'Sent the quote: £2,890, with a £578 deposit link.']]); });
        at(24.75, (s, t) => { focus(s, t, 'cust'); });
        at(25.38, (s, t) => { fl(s, t, 'Quote sent with a deposit link'); msg(s, t, { text: REVIEWS['q-ahmed'].msg, short: 'Here’s your quote for the new boiler: £2,890.', link: 'View your quote' }); });
        at(26.88, (s, t) => { note(s, t, `The deposit goes straight to ${OWN}’s account.`); });
        at(28.75, (s, t) => { focus(s, t, 'all'); });
      });

      /* 3 of 5. Tom does nothing here. */
      beat('followups', SVC.followups.label, 18.2, [
        [.7, 'Three days on, no reply.', 1.88], [3.8, `She gets a nudge, worded the way ${OWN} agreed.`, 2.61],
        [8.0, 'She says yes and pays the deposit, so the chasing stops and the install goes in the diary.', 5.23]], () => {
        card(0, 2);
        at(0, (s, t) => { chap(s, t, 2); wipe(s); head(s, t, SVC.followups.label); day(s, t, 'd3', '10:00'); focus(s, t, 'cust'); });
        at(1.5, (s, t) => { note(s, t, 'Three days on, no reply'); });
        at(4.3, (s, t) => { fl(s, t, `Nudge sent, in wording ${OWN} agreed`); feed(s, t, 'Nudged Mrs Ahmed about her quote (day 3).');
          job(s, {}, [['Sun 4 Oct', '10:00', 'fl', 'Nudged her about the quote (day 3).']]);
          msg(s, t, { day: 'Sun 4 Oct', text: `Hi Mrs Ahmed, just checking you got the quote for your new boiler. Any questions, reply here and ${OWN} will come back to you.`,
            short: 'Just checking you got the quote for your new boiler. Any questions, reply here.', link: 'View your quote' }); });
        at(7.1, (s, t) => { clock(s, t, '18:42'); tap(s, t, 'cust', '.c-row:last-child .c-link'); });
        at(7.4, (s, t) => { view(s, t, 'page', { kind: 'quote' }); });
        at(8.5, (s, t) => { tap(s, t, 'cust', '[data-pay="0"]'); });
        at(8.8, (s, t) => { s.cust.page = { kind: 'quote', ok: t }; });
        at(9.4, (s, t) => { tap(s, t, 'cust', '[data-pay="1"]'); });
        at(9.7, (s, t) => { s.cust.page = { kind: 'quote', ok: s.cust.page.ok, paid: t }; });
        at(10.7, (s, t) => { fl(s, t, 'Chasing stopped'); });
        at(11.6, (s, t) => { view(s, t, 'thread'); clock(s, t, '18:43'); });
        at(11.9, (s, t) => { fl(s, t, 'Install booked in the diary'); feed(s, t, 'Mrs Ahmed said yes and paid her deposit. Chasing stopped.'); feed(s, t, 'Booked Mrs Ahmed’s install for Thursday 15 October.');
          job(s, { st: 'accepted', next: 'We remind her the day before the install.', q: { amt: 2890, state: 'accepted' } },
            [['Sun 4 Oct', '18:42', 'cust', 'Accepted the quote and paid the £578 deposit.'], ['Sun 4 Oct', '18:42', 'fl', 'Stopped chasing. Install booked for 15 October.']]);
          msg(s, t, { text: `Thanks Mrs Ahmed, that’s your deposit paid. Your new boiler goes in on Thursday 15 October. ${OWN} will be with you from 8:30am.`,
            short: 'Deposit paid, thank you. Your new boiler goes in on Thursday 15 October.' }); });
        at(14.3, (s, t) => { day(s, t, 'd3b', '13:00'); fl(s, t, 'Reminder sent the day before');
          s.tom.feed.unshift(['13:00', null, 'Reminded Mrs Patel, Mrs Ahmed and Mr Davies about tomorrow’s visits.', t]);
          job(s, {}, [['Wed 14 Oct', '13:00', 'fl', 'Reminded her about the install.']]);
          msg(s, t, { day: 'Wed 14 Oct', text: `Reminder: ${OWN}’s fitting your new boiler tomorrow, Thursday, from 8:30am.`, short: `Reminder: ${OWN}’s fitting your new boiler tomorrow, from 8:30am.` }); });
        at(15.7, (s, t) => { note(s, t, `All while ${OWN} was on other jobs.`); focus(s, t, 'all'); });
      });

      /* 4 of 5. From here Tom's sending is shown the short way: a tap, and the note leaving his phone. */
      beat('paperwork', SVC.paperwork.label, 29.69, [
        [.7, 'Job day.', .56], [2, `${OWN} sends photos and a voice note: “Done. Fitted a filter as well.”`, 4.36],
        [8.2, 'Front-line builds the job record and a draft report.', 2.77], [12.4, `${OWN} checks it and signs it off.`, 1.83],
        [20.48, 'Front-line prepares the Gas Safe details and tracks the deadline.', 3.29], [24.88, `${OWN} sends the notification himself.`, 2.14]], () => {
        card(0, 3);
        at(0, (s, t) => { chap(s, t, 3); wipe(s); head(s, t, SVC.paperwork.label); day(s, t, 'd4', '13:48'); focus(s, t, 'tom'); job(s, { st: 'today', next: 'Send a voice note when it’s done and we raise the invoice.' }); });
        at(1.5, (s, t) => { note(s, t, 'Job day'); });
        at(2.3, (s, t) => { tap(s, t, 'tom', sendBtn); });
        at(2.6, (s, t) => { vn(s, t, '“Done. Fitted a filter as well.”', 'cam mic', 4.3, 1.9, t + 1.7); tomDid(s, t, 'Photos and a voice note:', '“Done. Fitted a filter as well.”', 1.9, t + 1.7);
          job(s, {}, [['Thu 15 Oct', '13:48', 'you', 'Sent photos and a voice note: “Done, fitted a filter as well.”']]); });
        at(9.2, (s, t) => { clock(s, t, '14:02'); s.tom.report = false; go(s, t, { name: 'section', id: 'paperwork' }); scr(s, t, 'section:nth-of-type(2)', .01); fl(s, t, 'Job record built'); feed(s, t, 'Built the job record for Mrs Ahmed’s boiler. Draft report ready to check.');
          job(s, { next: 'Tell us if the filter goes on the invoice.' }, [['Thu 15 Oct', '14:02', 'fl', 'Built the job record and a draft report. One photo is missing: the flue.']]); });
        at(10.2, (s, t) => { fl(s, t, `Draft report, ready for ${OWN} to check`); spot(s, t, '[data-act="check-report"]', '.row'); });
        at(12.7, (s, t) => { tap(s, t, 'tom', '[data-act="check-report"]'); });
        at(13, (s, t) => { clock(s, t, '14:03'); s.tom.report = true; unspot(s); tomDid(s, t, 'One tap: “Looks right”'); job(s, {}, [['Thu 15 Oct', '14:03', 'you', 'Checked the draft report.']]); });
        at(14.6, (s, t) => { page(s, t); fl(s, t, 'Missing photo flagged: the flue'); spot(s, t, '[data-act="sheet"][data-id="flue"]', '.row'); });
        at(17.58, (s, t) => { tap(s, t, 'tom', '[data-act="sheet"][data-id="flue"]'); });
        at(17.88, (s, t) => { clock(s, t, '14:04'); unspot(s); s.tom.flue = true; vn(s, t, 'The flue', 'cam', 1.5); tomDid(s, t, 'The flue photo, added');
          job(s, {}, [['Thu 15 Oct', '14:04', 'you', 'Added the photo of the flue.']]); });
        at(19.88, (s, t) => { clock(s, t, '14:06'); scr(s, t, 'section:nth-of-type(3)', .8); });
        at(21.38, (s, t) => { fl(s, t, 'Gas Safe details prepared'); feed(s, t, 'Prepared the Gas Safe details for Mrs Ahmed’s boiler. Due by 14 November.');
          job(s, {}, [['Thu 15 Oct', '14:06', 'fl', 'Prepared the Gas Safe notification details. Due by 14 November.']]); spot(s, t, '[data-act="gas-sent"]', '.row'); });
        at(22.88, (s, t) => { fl(s, t, '30-day deadline tracked'); });
        at(25.58, (s, t) => { tap(s, t, 'tom', '[data-act="gas-sent"]'); });
        at(25.88, (s, t) => { clock(s, t, '14:15'); s.tom.gas = true; unspot(s); tomDid(s, t, `Gas Safe notification sent, by ${OWN} himself`); job(s, {}, [['Thu 15 Oct', '14:15', 'you', 'Sent the Gas Safe notification.']]); });
        at(27.88, (s, t) => { focus(s, t, 'all'); });
      });

      /* 5 of 5. The extra, the invoice, the reminder, the payment. */
      beat('invoices', SVC.invoices.label, 27.13, [
        [.7, 'And Front-line spots the filter isn’t on the quote.', 2.65], [4.6, 'One tap adds it to the invoice.', 1.91],
        [8.9, 'The invoice is the quote, less the deposit, plus the filter.', 3.66], [13.23, `${OWN} approves it, and it goes out with a link to pay.`, 2.64],
        [18.03, 'When it’s a week late, a reminder goes out for him.', 2.97], [22.43, 'She pays, and the reminders stop.', 1.96]], () => {
        card(0, 4);
        at(0, (s, t) => { chap(s, t, 4); wipe(s); head(s, t, SVC.invoices.label); clock(s, t, '14:16'); go(s, t, { name: 'home' }); focus(s, t, 'tom'); });
        at(1.5, (s, t) => { fl(s, t, 'Spotted: the filter isn’t on the quote'); s.tom.ok = ['x-ahmed']; s.tom.born['x-ahmed'] = t;
          job(s, {}, [['Thu 15 Oct', '14:16', 'fl', 'Spotted the filter is not on the quote. Asked you about the invoice.']]);
          spot(s, t + .3, '[data-act="review"][data-id="x-ahmed"]', '.row'); });
        at(3.7, (s, t) => { tap(s, t, 'tom', '[data-act="review"][data-id="x-ahmed"]'); });
        at(4, (s, t) => { go(s, t, { name: 'review', id: 'x-ahmed' }); clock(s, t, '14:20'); });
        at(4.4, (s, t) => { spot(s, t, '[data-act="extra"][data-v="add"]'); });
        at(5.2, (s, t) => { tap(s, t, 'tom', '[data-act="extra"][data-v="add"]'); });
        at(5.5, (s, t) => { go(s, t, { name: 'home' }); s.tom.filter = 'added'; s.tom.ok = ['i-ahmed']; s.tom.born['i-ahmed'] = t + 1.5; toast(s, t, 'Filter added. Her invoice is ready for your OK.');
          tomDid(s, t, 'One tap: “Add it to the invoice”');
          job(s, { next: 'Approve the invoice and we send it with a pay-now link.', inv: { amt: 2457, state: 'draft' } },
            [['Thu 15 Oct', '14:20', 'you', 'Said the filter goes on the invoice.'], ['Thu 15 Oct', '14:20', 'fl', 'Raised the invoice: £2,457. Ready for your OK.']]); });
        at(7, (s, t) => { fl(s, t, 'Invoice raised from the quote'); feed(s, t, 'Raised Mrs Ahmed’s invoice for £2,457, with the filter added.'); spot(s, t, '[data-act="review"][data-id="i-ahmed"]', '.row'); });
        at(8.3, (s, t) => { tap(s, t, 'tom', '[data-act="review"][data-id="i-ahmed"]'); });
        at(8.6, (s, t) => { go(s, t, { name: 'review', id: 'i-ahmed' }); clock(s, t, '14:21'); });
        at(8.9, (s, t) => { spot(s, t, '.kv', 'section'); });
        at(12.83, (s, t) => { spot(s, t, '[data-act="approve"]'); });
        at(13.73, (s, t) => { tap(s, t, 'tom', '[data-act="approve"]'); });
        at(14.03, (s, t) => { go(s, t, { name: 'home' }); s.tom.ok = []; toast(s, t, 'Invoice sent to Mrs Ahmed.'); tomDid(s, t, 'One tap: “Approve and send”');
          feed(s, t, 'Sent Mrs Ahmed the invoice for £2,457 after your OK.');
          job(s, { st: 'sent', next: 'First reminder 7 days after it’s due. We stop when it’s paid.', inv: { amt: 2457, state: 'sent', note: 'Due on 29 October' } },
            [['Thu 15 Oct', '14:21', 'you', 'Approved the invoice.'], ['Thu 15 Oct', '14:21', 'fl', 'Sent the invoice: £2,457, with a pay-now link.']]); });
        at(14.63, (s, t) => { focus(s, t, 'cust'); });
        at(15.13, (s, t) => { fl(s, t, 'Sent with a link to pay');
          msg(s, t, { day: 'Thu 15 Oct', text: `Hi Mrs Ahmed, it’s ${OWN} from ${FIRM}. Your new boiler is in. Here’s the invoice for the balance: £2,457. You can pay it from the link.`,
            short: 'Your new boiler is in. Here’s the invoice for the balance: £2,457.', link: 'View your invoice' }); });
        at(18.03, (s, t) => { page(s, t); day(s, t, 'd5', '09:00'); note(s, t + .3, 'A week late');
          job(s, { st: 'overdue', next: 'Next reminder on 12 November. We stop as soon as she pays.', inv: { amt: 2457, state: 'overdue', note: 'Was due on 29 October' } }); });
        at(19.53, (s, t) => { fl(s, t, 'Reminder sent, a week late'); feed(s, t, 'Sent Mrs Ahmed a reminder. Her invoice is 7 days late.');
          job(s, {}, [['Thu 5 Nov', '09:00', 'fl', 'Sent a reminder. The invoice was 7 days late.']]);
          msg(s, t, { day: 'Thu 5 Nov', text: 'Hi Mrs Ahmed, a quick reminder that the invoice for your boiler (£2,457) was due on 29 October. You can pay from the link. If it’s already paid, thank you.',
            short: 'A quick reminder that the invoice for your boiler (£2,457) was due on 29 October.', link: 'Pay now' }); });
        at(21.63, (s, t) => { clock(s, t, '12:10'); tap(s, t, 'cust', '.c-row:last-child .c-link'); });
        at(21.93, (s, t) => { view(s, t, 'page', { kind: 'invoice' }); });
        at(22.53, (s, t) => { tap(s, t, 'cust', '[data-pay="0"]'); });
        at(22.83, (s, t) => { s.cust.page = { kind: 'invoice', paid: t }; });
        at(23.93, (s, t) => { view(s, t, 'thread'); });
        at(24.13, (s, t) => { fl(s, t, 'Marked paid. Reminders stopped.'); feed(s, t, 'Mrs Ahmed paid £2,457. Invoice marked paid. Reminders stopped.');
          job(s, { st: 'paid', next: 'Nothing left to do on the money.', inv: { amt: 2457, state: 'paid', note: 'Paid on 5 November' } },
            [['Thu 5 Nov', '12:10', 'cust', 'Paid £2,457.'], ['Thu 5 Nov', '12:10', 'fl', 'Marked the invoice paid. Reminders stopped.']]);
          msg(s, t, { text: 'Paid, thank you. Here’s your receipt.', link: 'View receipt' }); focus(s, t, 'all'); });
      });

      /* And then. Three things that happen with nobody asking. */
      beat('after', 'After the job', 20.53, [
        [.7, 'The next day, she’s asked for a review.', 2.06], [5.0, `Every Friday, ${OWN} gets a summary of what’s quoted, what’s owed and what’s overdue.`, 4.96],
        [12.0, 'A year on, Front-line tells her the boiler’s due a service.', 3.34], [16.4, 'She says yes, and it’s booked in.', 1.9]], () => {
        card(0, 5);
        at(0, (s, t) => { chap(s, t, 5); wipe(s); head(s, t, 'After the job'); day(s, t, 'd6', '10:00'); focus(s, t, 'cust'); });
        at(1.5, (s, t) => { note(s, t, 'The next day'); });
        at(2.3, (s, t) => { fl(s, t, 'Review asked for'); feed(s, t, 'Asked Mrs Ahmed for a review. She paid yesterday.'); job(s, {}, [['Fri 6 Nov', '10:00', 'fl', 'Asked her for a review.']]);
          msg(s, t, { day: 'Fri 6 Nov', text: `Thanks again for choosing ${FIRM}. If you have a minute, a short review would really help us.`, short: `Thanks again for choosing ${FIRM}. A short review would really help us.`, link: 'Leave a review' }); });
        at(4.6, (s, t) => { clock(s, t, '16:00'); go(s, t, { name: 'money' }); focus(s, t, 'tom'); });
        at(5.2, (s, t) => { note(s, t, 'Every Friday'); });
        at(6.5, (s, t) => { fl(s, t, 'Weekly money summary sent'); spot(s, t, '.money'); });
        at(11.4, (s, t) => { page(s, t); note(s, t + .6, 'A year on'); s.tom.day = 'd7'; s.tom.feed = []; clock(s, t, '09:00'); go(s, t, { name: 'job', id: 'ahmed' }); job(s, { next: 'We tell her when her first service is due.' }); focus(s, t, 'cust'); });
        at(13.4, (s, t) => { fl(s, t, 'Service reminder sent'); job(s, {}, [['Fri 1 Oct 2027', '09:00', 'fl', 'Told her the boiler’s first service is due this month.']]);
          msg(s, t, { day: 'Fri 1 Oct 2027', text: `Hi Mrs Ahmed, it’s ${FIRM}. Your boiler’s first service is due this month. Want us to book it in? Reply with a day that suits. Reply STOP if you’d rather not get these.`,
            short: 'Your boiler’s first service is due this month. Want us to book it in? Reply STOP to opt out.' }); });
        at(16.8, (s, t) => { clock(s, t, '11:32'); msg(s, t, { me: 1, text: 'Yes please. A Wednesday afternoon if you can.' }); });
        at(17.7, (s, t) => { clock(s, t, '11:33'); fl(s, t, 'Service booked');
          job(s, { st: 'booked', next: 'We remind her on Tuesday about Wednesday’s service.' }, [['Fri 1 Oct 2027', '11:32', 'cust', 'Replied and asked for a Wednesday afternoon.'], ['Fri 1 Oct 2027', '11:33', 'fl', 'Booked the service for Wednesday 13 October, 2pm.']]);
          msg(s, t, { text: 'Booked: Wednesday 13 October at 2pm. We’ll remind you the day before.' }); });
        at(19.4, (s, t) => { focus(s, t, 'all'); });
      });

      beat('outro', 'Who did what', 23.3, [
        [1.0, `From the first call to a year on, ${OWN} did nine small things.`, 4.25], [6.4, 'Front-line did thirty-two.', 1.75],
        [9.6, 'AI does the routine work. We set it up around the way you work, and keep it running.', 5.19], [17.1, 'You do the job. We’ll do the admin.', 2.21]], () => {
        at(0, (s, t) => { chap(s, t, 6); page(s, t); head(s, t, 'From the first call|to a year on.'); focus(s, t, 'all'); s.tom.scroll = { from: 0, to: null, end: 1, t0: t + .8, dur: 7 }; });
        at(3.5, (s, t) => { head(s, t, `${OWN} did 9|small things.`); s.did.tomAt = t; s.tally = { tom: t + .3, fl: null }; });
        at(6.6, (s, t) => { head(s, t, 'Front-line|did 32.'); s.did.flAt = t; s.tally = { tom: s.tally.tom, fl: t + .4 }; });
        at(9.5, (s, t) => { head(s, t, 'AI does the routine work.|We set it up|and keep it running.'); go(s, t, { name: 'rules' }); s.tom.scroll = { from: 0, to: null, end: 1, t0: t + .8, dur: 5.4 }; });
        at(15.52, (s, t) => { s.lay = { from: layAt(s.lay, t), to: Object.assign({}, LAY.off), t0: t, dur: .9 }; s.card = { name: 'end', t0: t + .8 }; });
      });

      DUR = T;
      cues.sort((a, b) => a[0] - b[0]);

      /* the state before anything happens, then a copy after every cue */
      const s = {
        head: null, items: [], old: null, tally: null, did: { tom: 0, fl: 0, tomAt: -9, flAt: -9 },
        lay: { from: Object.assign({}, LAY.off), to: Object.assign({}, LAY.off), t0: 0, dur: .01 },
        card: { name: 'in', t0: 0 }, focus: { who: 'all', was: 'all', t0: -9 }, chap: { n: -1, t0: 0 },
        tom: { day: 'd1', clock: '11:14', feed: [], ok: [], born: {}, filter: null, report: null, flue: false, gas: false, sheet: null, toast: null, tap: null, spot: null, vn: null, route: { name: 'home' }, nav: -9,
          scroll: { from: 0, to: 0, t0: 0, dur: .01 },
          ahmed: { c: 'Mrs Ahmed', t: 'Boiler replacement', a: '27 Station Road', st: 'booked', next: 'We remind her the day before the visit.', tl: [] } },
        cust: { view: 'idle', nav: -9, clock: '11:14', msgs: [], call: [], page: null, tap: null, live: null }
      };
      snaps = [{ at: 0, s: structuredClone(s) }];
      cues.forEach(([t, fn]) => { fn(s, t); snaps.push({ at: t, s: structuredClone(s) }); });
      let was = '', flash = -9;
      snaps.forEach(n => {
        n.data = tomData(n.s.tom);
        const tt = withData(n.data, totals), sum = n.s.tom.day + '|' + tt.quoted + '|' + tt.owed + '|' + tt.over;
        if (sum !== was) { flash = was.split('|')[0] === n.s.tom.day ? n.at : -9; was = sum; }
        n.flash = flash;
      });
    }

    /* the narration lines with their times; a line stays up until it has been said or the next one starts */
    const SAY = 2.5;   /* words a second, for a line with no recorded length (the third number in a narration line is the recorded voice's length) */
    function captions() {
      const all = [];
      beats.forEach(b => b.lines.forEach(l => all.push({ t0: l.t0, text: l.text, need: l.dur || l.text.split(/\s+/).length / SAY, end: b.t1 })));
      all.forEach((c, i) => { const next = all[i + 1] ? all[i + 1].t0 : DUR; c.t1 = Math.min(next - .05, c.t0 + c.need + .7); c.late = c.t0 + c.need > Math.min(next, c.end) + .05; });
      return all;
    }

    /* ---------- the stage ---------- */
    let $ = null, caps = [], showCaps = true, lastK = -1, lastHTML = {}, cur = 0, playing = false, raf = 0, startedAt = 0, startedFrom = 0, capture = false;
    const phone = (id, inner) => `<div class="f-phone" id="${id}"><div class="f-body"><div class="f-screen"><div class="f-status"><span data-clock></span><span><i></i><em></em></span></div>${inner}<div class="f-tap"></div></div></div></div>`;
    function mount() {
      el.innerHTML = `
        <div class="film-bar"><button class="btn" data-act="film-close">${icon('i-back')}<span>Back to the app</span></button><h1 id="fl-film-h" tabindex="-1">The example job</h1></div>
        <div class="film-fit" id="fl-film-fit"><div class="film-stage" aria-hidden="true" inert>
          <div class="f-world">
            ${phone('f-tom', '<div class="app film-app" data-bar="send"><div class="main"><div class="screen wide"></div></div><div class="bar"></div><div class="toast"></div><div class="sheet-wrap" hidden></div></div><div class="f-spot"></div><div class="f-vn"></div>')}
            ${phone('f-cust', '<div class="c-host"></div>')}
          </div>
          <div class="f-hd f-hd-tom"><small></small><div><span>did</span><b>0</b><span data-u></span></div></div>
          <div class="f-hd f-hd-fl"><small><svg class="f-logo"><use href="#logo-light"></use></svg><span class="f-eg">Example job</span></small><div><span>did</span><b>0</b><span data-u></span></div></div>
          <div class="f-hd f-hd-cust"><small>The customer</small><div>Mrs Ahmed</div></div>
          <div class="f-mid"><div class="f-chap"></div><div class="f-head"></div><div class="f-list"><div class="f-list-old"></div><div class="f-list-in"></div></div><div class="f-cap"></div></div>
          <div class="f-card f-card-in"><svg class="f-logo"><use href="#logo-light"></use></svg><h3>Here’s an example job.</h3><p>One new boiler, from the first phone call to a year on.</p></div>
          <div class="f-card f-card-end"><svg class="f-logo"><use href="#logo-light"></use></svg><h3><span>You do the job.</span><span><em>We’ll do the admin.</em></span></h3><p>Take one service, a few, or all five.</p><div class="f-contact"><span>vanrooyenenterprises.com</span><i></i><span>07771 542157</span></div><p class="dim">No setup fee. No contract.</p></div>
          <div class="f-day"></div>
          <div class="f-rail"></div>
        </div></div>
        <div class="film-ui">
          <div class="film-ctl">
            <button class="btn go" id="fl-film-play" data-act="film-play">Play</button>
            <button class="btn" data-act="film-step" data-v="-1">${icon('i-back')}<span>Step back</span></button>
            <button class="btn" data-act="film-step" data-v="1"><span>Next step</span>${icon('i-chev')}</button>
            <input class="film-seek" id="fl-film-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Place in the film">
            <span class="film-time" id="fl-film-time">0:00</span>
            <button class="btn" id="fl-film-caps" data-act="film-caps" aria-pressed="true">Script on screen</button>
            <button class="btn" data-act="film-full">Full screen</button>
          </div>
          <div class="film-now" id="fl-film-now"></div>
          <section class="film-script"><h2>The film, step by step</h2><ol id="fl-film-steps"></ol></section>
        </div>`;
      const q = s => el.querySelector(s);
      $ = { fit: q('.film-fit'), stage: q('.film-stage'), tom: q('#f-tom'), cust: q('#f-cust'), tomApp: q('.film-app'), tomMain: q('.film-app .main'), tomScreen: q('.film-app .screen'),
        tomBar: q('.film-app .bar'), tomToast: q('.film-app .toast'), tomSheet: q('.film-app .sheet-wrap'), spot: q('.f-spot'), vn: q('.f-vn'), custHost: q('.c-host'),
        hdTom: q('.f-hd-tom'), hdFl: q('.f-hd-fl'), hdCust: q('.f-hd-cust'), mid: q('.f-mid'), chap: q('.f-chap'), head: q('.f-head'), list: q('.f-list'), listOld: q('.f-list-old'), listIn: q('.f-list-in'), cap: q('.f-cap'), day: q('.f-day'),
        cardIn: q('.f-card-in'), cardEnd: q('.f-card-end'), rail: q('.f-rail'), play: q('#fl-film-play'), seek: q('#fl-film-seek'), time: q('#fl-film-time'), now: q('#fl-film-now'), steps: q('#fl-film-steps'), capsBtn: q('#fl-film-caps') };
      $.seek.addEventListener('input', () => { pause(); seek($.seek.value / 1000 * DUR); });
      new ResizeObserver(fit).observe($.fit);
      document.addEventListener('fullscreenchange', fit);
    }
    function fit() {
      if (!$) return;
      const w = $.fit.clientWidth, h = $.fit.clientHeight;
      const k = capture ? 1 : Math.min(w / FW, h / FH);
      $.stage.style.setProperty('--k', k);
      $.stage.style.left = capture ? '0' : (w - FW * k) / 2 + 'px';
      $.stage.style.top = capture ? '0' : (h - FH * k) / 2 + 'px';
    }

    const set = (key, node, html) => { if (lastHTML[key] !== html) { lastHTML[key] = html; node.innerHTML = html; return true; } return false; };
    const noIds = h => h.replace(/ id="/g, ' data-fid="').replace(/ for="[^"]*"/g, '').replace(/ aria-labelledby="[^"]*"/g, '');

    function custHTML(c) {
      const firm = esc(APP.firm), av = `<span class="c-av">${esc(APP.firm.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>`;
      if (c.view === 'idle') return `<div class="c-lock"><b>${esc(c.clock)}</b><span>Monday 28 September</span></div>`;
      if (c.view === 'call') {
        return `<div class="c-call"><div class="c-who">${av}<span><b>${firm}</b><small data-call>Calling…</small></span></div><div class="c-lines">${c.call.map(l =>
          `<div class="c-row${l.me ? ' c-me' : ''}" data-in="${l.t0}"><div><div class="c-say"><small>${l.me ? 'Mrs Ahmed' : firm}</small>${esc(l.text)}</div></div></div>`).join('')}</div>
          <span class="c-end"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.2 14.7c4.9-4.6 12.7-4.6 17.6 0 .5.5.5 1.2.1 1.7l-1.6 1.9c-.4.5-1.1.6-1.6.3l-2.5-1.5c-.5-.3-.7-.8-.6-1.3l.2-1.5c-1.8-.5-3.8-.5-5.6 0l.2 1.5c.1.5-.1 1-.6 1.3l-2.5 1.5c-.5.3-1.2.2-1.6-.3l-1.6-1.9c-.4-.5-.4-1.2.1-1.7z"></path></svg></span></div>`;
      }
      if (c.view === 'page') {
        const p = c.page, quote = p.kind === 'quote';
        const lines = quote ? REVIEWS['q-ahmed'].lines : [['Boiler replacement, as quoted', 2890], ['Magnetic filter, supplied and fitted', 145], ['Deposit paid on 4 October', -578]];
        const done = (t, text) => `<div class="c-done" data-in="${t}" data-fx="pop">${icon('i-check')}<span>${text}</span></div>`;
        const btn = (n, cls, text) => `<span class="btn btn-lg btn-block ${cls}" data-pay="${n}">${text}</span>`;
        const acts = quote
          ? (p.ok ? done(p.ok, 'Quote accepted') : btn(0, 'btn-ink', 'Accept quote')) + (p.paid ? done(p.paid, `Deposit paid: £578`) : btn(1, p.ok ? 'btn-ink' : 'btn-line', 'Pay £578 deposit'))
          : (p.paid ? done(p.paid, 'Paid: £2,457. Thank you.') : btn(0, 'btn-ink', 'Pay £2,457 now'));
        return `<div class="c-page"><div class="c-bar"><span>Done</span><small><svg class="i-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path></svg>No login needed</small></div>
          <div class="c-doc"><span class="t2">${firm}</span><h3>${quote ? 'Your quote: new boiler' : 'Your invoice: new boiler'}</h3>
          <div class="total"><b>${money(quote ? 2890 : 2457)}</b><span class="meta">including VAT</span></div>
          <div class="card"><ul class="kv">${lines.map(l => `<li><span>${esc(l[0])}</span><b>${money(l[1])}</b></li>`).join('')}</ul></div>
          ${acts}<p class="c-note">${quote ? `The deposit is paid straight to ${firm}.` : `Paid straight to ${firm}.`}</p></div></div>`;
      }
      return `<div class="c-app"><div class="c-top">${icon('i-back')}${av}<span><b>${firm}</b><small>Heating engineers</small></span></div>
        <div class="c-thread">${c.msgs.map(m => `<div class="c-row${m.me ? ' c-me' : ''}" data-in="${m.t0}"><div>${m.day ? `<span class="c-day">${esc(m.day)}</span>` : ''}<div class="c-b"><span>${esc(m.short || m.text)}</span>${m.link ? `<span class="c-link">${esc(m.link)}${icon('i-chev', 'i-16')}</span>` : ''}<time>${esc(m.time)}</time></div></div></div>`).join('')}</div>
        <div class="c-in"><span>Message</span><i>${icon('i-arrow', 'i-16')}</i></div></div>`;
    }

    /* everything that only changes when a cue fires */
    function paint(n) {
      const s = n.s, m = s.tom;
      const tomHTML = withData(n.data, () => ({ screen: screenHTML(m.route), bar: barHTML(m.route), sheet: m.sheet ? sheetBody() : '' }));
      set('tomScreen', $.tomScreen, noIds(tomHTML.screen));
      $.tomApp.dataset.bar = tomHTML.bar[0];
      set('tomBar', $.tomBar, tomHTML.bar[1]);
      let sh = noIds(tomHTML.sheet);
      if (m.sheet && m.sheet.photos) sh = sh.replace(/<p class="meta">(\d) photos? added\.<\/p>/, (all, n) => `<div class="f-thumbs">${('<span>' + icon('i-camera') + '</span>').repeat(+n)}</div>${all}`);
      set('tomSheet', $.tomSheet, m.sheet ? `<div class="sheet">${sh}</div>` : '');
      $.tomSheet.hidden = !m.sheet;
      set('tomToast', $.tomToast, m.toast ? `<div class="toast-in"><span>${esc(m.toast.text)}</span></div>` : '');
      set('vn', $.vn, m.vn ? `<div>${m.vn.kind.split(' ').map(k => `<i>${icon(k === 'cam' ? 'i-camera' : 'i-mic', '')}</i>`).join('')}<span data-full="${esc(m.vn.text)}">${esc(m.vn.text)}</span></div>` : '');
      set('cust', $.custHost, custHTML(s.cust));
      $.cust.querySelector('.f-status').style.color = s.cust.view === 'call' || s.cust.view === 'idle' ? '#FBF4EB' : '';
      $.tom.querySelector('[data-clock]').textContent = m.clock;
      $.cust.querySelector('[data-clock]').textContent = s.cust.clock;
      const k = s.chap.n;
      set('chap', $.chap, k >= 0 && k < 5 ? `<i></i><svg aria-hidden="true"><use href="#${SVC[CHAPS[k]].icon}"></use></svg><span>${k + 1} of 5</span>` : k === 5 ? '<i></i><span>And then</span>' : '');
      const lines = text => text.split('|').map(l => `<span>${esc(l)}</span>`).join('');
      set('head', $.head, s.head ? `<div class="f-was">${s.head.was ? lines(s.head.was) : ''}</div><div>${lines(s.head.text)}</div>` : '');
      const dots = (cls, name, n, t0, gap) => `<div class="f-tl ${cls}"><small>${esc(name)}</small><p>${Array.from({ length: n }, (x, i) => `<i data-pop="${(t0 + i * gap).toFixed(3)}"></i>`).join('')}</p></div>`;
      const row = (i, next, live) => `<div class="f-it ${i.who}"${live ? ` data-in="${i.t0}" data-next="${next}"${i.typed && i.sub ? ` data-typed="${i.typed}" data-from="${i.from}"` : ''}` : ''}><div${live ? '' : ` style="opacity:${next === '' ? 1 : BACK}"`}><p>${icon(i.who === 'fl' ? 'i-check' : i.who === 'tom' ? 'i-arrow' : 'i-alert', '')}<span>${esc(i.text)}</span></p>${i.sub ? `<small data-full="${esc(i.sub)}">${esc(i.sub)}</small>` : ''}</div></div>`;
      const rows = (items, live) => items.slice(-8).map((i, k, a) => row(i, a[k + 1] ? a[k + 1].t0 : '', live)).join('');
      set('old', $.listOld, s.old ? rows(s.old.items, false) : '');
      set('list', $.listIn, s.tally ? dots('tom', APP.owner, s.did.tom, s.tally.tom, .13) + (s.tally.fl === null ? '' : dots('fl', 'Front-line', s.did.fl, s.tally.fl, .045)) : rows(s.items, true));
      $.hdTom.querySelector('b').textContent = s.did.tom;
      $.hdTom.querySelector('[data-u]').textContent = s.did.tom === 1 ? 'small thing' : 'small things';
      $.hdFl.querySelector('b').textContent = s.did.fl;
      $.hdFl.querySelector('[data-u]').textContent = s.did.fl === 1 ? 'thing' : 'things';
    }

    /* where a tap lands, how far a screen scrolls and where a spotlight sits, measured once from the real layout */
    const offIn = (node, root) => { let x = 0, y = 0; while (node && node !== root) { x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent; } return [x, y]; };
    function measure() {
      let sc0 = { t0: null, from: 0, to: 0 };
      const tp0 = { tom: null, cust: null };
      snaps.forEach(n => {
        paint(n);
        const sc = n.s.tom.scroll;
        if (sc.t0 === sc0.t0) { sc.from = sc0.from; sc.to = sc0.to; }
        else {
          const max = Math.max(0, $.tomMain.scrollHeight - 690);
          if (sc.to === null) {
            const target = sc.end ? null : $.tomScreen.querySelector(sc.sel);
            sc.to = sc.end ? max : target ? clamp(offIn(target, $.tomApp)[1] - 96, 0, max) : 0;
          }
          if (sc.from === null) sc.from = sc0.to;
          sc0 = { t0: sc.t0, from: sc.from, to: sc.to };
        }
        [['tom', $.tom], ['cust', $.cust]].forEach(([who, node]) => {
          const tp = n.s[who].tap;
          if (!tp) return;
          if (tp0[who] && tp0[who].t0 === tp.t0) { tp.x = tp0[who].x; tp.y = tp0[who].y; return; }
          const screenEl = node.querySelector('.f-screen'), target = screenEl.querySelector(tp.sel);
          if (target) {
            const o = offIn(target, screenEl);
            tp.x = o[0] + target.offsetWidth / 2;
            tp.y = o[1] + target.offsetHeight / 2 - (who === 'tom' && $.tomMain.contains(target) ? sc.to : 0);
          }
          tp0[who] = { t0: tp.t0, x: tp.x, y: tp.y };
        });
        const sp = n.s.tom.spot;
        if (sp) {
          let target = $.tomApp.querySelector(sp.sel);
          if (target && sp.up) target = target.closest(sp.up);
          if (target) {
            const o = offIn(target, $.tom.querySelector('.f-screen'));
            sp.x = o[0]; sp.y = o[1]; sp.w = target.offsetWidth; sp.h = target.offsetHeight; sp.inMain = $.tomMain.contains(target);
          }
        }
      });
      lastK = -1;
    }

    /* words written out one at a time, from `from` over `dur` seconds: what Tom is saying into his phone */
    function typeOut(span, t, from, dur) {
      const full = span.dataset.full, words = full.split(' ');
      const show = Math.ceil(words.length * clamp((t - from) / dur, 0, 1));
      span.textContent = show >= words.length ? full : words.slice(0, show).join(' ') + (show ? '…' : '“…');
    }

    /* everything that moves with the clock */
    function frame(n, t) {
      const s = n.s, L = layAt(s.lay, t), m = s.tom, c = s.cust;
      $.tom.style.transform = `translate(${L.tx}px,${L.ty}px) scale(${L.ts})`;
      $.cust.style.transform = `translate(${L.cx}px,${L.cy}px) scale(${L.cs})`;
      $.mid.style.transform = `translate(${L.mx}px,0)`;
      $.mid.style.opacity = L.mo;
      $.hdTom.style.transform = `translate(${L.tx}px,0)`;
      $.hdFl.style.transform = `translate(${L.mx}px,0)`;
      $.hdCust.style.transform = `translate(${L.cx}px,0)`;
      $.hdTom.style.opacity = $.hdFl.style.opacity = $.hdCust.style.opacity = $.rail.style.opacity = L.hd;
      $.hdTom.querySelector('b').style.transform = `scale(${1 + .2 * bell((t - s.did.tomAt) / .55)})`;
      $.hdFl.querySelector('b').style.transform = `scale(${1 + .2 * bell((t - s.did.flAt) / .55)})`;
      /* which phone to watch: the other is turned down. The column heads stay lit. */
      const F = s.focus, fp = eIO((t - F.t0) / .45), lit = (who, col) => who === 'all' || who === col ? 1 : DIM;
      $.tom.firstChild.style.opacity = mix(lit(F.was, 'tom'), lit(F.who, 'tom'), fp);
      $.cust.firstChild.style.opacity = mix(lit(F.was, 'cust'), lit(F.who, 'cust'), fp);
      /* a chapter card covers the stage while the chapter changes underneath it */
      const dc = cards.filter(d => t > d.t - .5).pop() || cards[0];
      $.day.style.opacity = Math.min(clamp((t - dc.t + .5) / .3, 0, 1), 1 - clamp((t - dc.t - CARD_UP) / .3, 0, 1));
      set('day', $.day, `<small>${esc(dc.sub)}</small><span>${dc.icon ? `<svg aria-hidden="true"><use href="#${dc.icon}"></use></svg>` : ''}</span><b>${esc(dc.title)}</b>`);
      $.day.lastChild.style.transform = `translateY(${(1 - eOut((t - dc.t + .5) / .55)) * 34}px)`;
      /* the map: each service's bar fills while its chapter runs */
      $.rail.childNodes.forEach((seg, i) => {
        const b = beats[i + 1], on = eIO((t - b.t0 + .3) / .5), done = eIO((t - b.t1) / .5);
        seg.style.opacity = mix(mix(.4, 1, on), .72, done);
        seg.lastChild.firstChild.style.width = clamp((t - b.t0) / (b.t1 - b.t0), 0, 1) * 100 + '%';
      });

      /* Tom's phone */
      $.tomMain.style.transform = `translateY(${-twAt(m.scroll, t)}px)`;
      const nav = eOut((t - m.nav) / .3);
      $.tomScreen.style.opacity = .25 + .75 * nav;
      $.tomScreen.style.transform = `translateX(${(1 - nav) * 26}px)`;
      const sh = m.sheet;
      const shOn = !!(sh && (!sh.shut || t < sh.shut + .25));
      $.tomSheet.hidden = !shOn;
      if (shOn) {
        const p = eOut((t - sh.t0) / .3) * (sh.shut ? 1 - eOut((t - sh.shut) / .25) : 1);
        $.tomSheet.style.backgroundColor = `rgba(16,22,42,${.5 * p})`;
        $.tomSheet.firstChild.style.transform = `translateY(${(1 - p) * 105}%)`;
        if (sh.step === 'rec') {
          const sec = Math.min(sh.max, Math.floor((t - sh.rec) * sh.rate));
          const tm = $.tomSheet.querySelector('.timer');
          if (tm) tm.textContent = '0:' + String(sec).padStart(2, '0');
          $.tomSheet.querySelectorAll('.rec i').forEach((b, i) => { b.style.height = 10 + 38 * Math.abs(Math.sin(t * 6.3 + i * 1.7) * Math.sin(t * 2.1 + i * .6)) + 'px'; });
        }
      }
      const ts = m.toast, tsP = ts ? eOut((t - ts.t0) / .3) * (1 - eOut((t - ts.t0 - ts.dur) / .3)) : 0;
      $.tomToast.style.opacity = tsP;
      $.tomToast.style.transform = `translateY(${(1 - tsP) * 18}px)`;
      const glow = 1 - clamp((t - n.flash - .15) / 1.7, 0, 1);
      $.tomApp.querySelectorAll('.money .fig').forEach(g => { g.style.boxShadow = glow > 0 && glow < 1 ? `inset 0 0 0 ${2.5 * glow}px rgba(43,126,133,${glow})` : ''; });
      $.tomApp.querySelectorAll('[data-in]').forEach(r => {
        const p = eOut((t - r.dataset.in) / .45), glow = 1 - clamp((t - r.dataset.in - .3) / 1.6, 0, 1);
        r.style.opacity = p;
        r.style.transform = `translateY(${(1 - p) * 12}px)`;
        r.style.backgroundColor = `rgba(43,126,133,${.2 * glow})`;
      });
      const sp = m.spot, spP = sp && sp.w && !shOn ? eOut((t - sp.t0) / .4) : 0;
      $.spot.style.opacity = spP;
      $.spot.style.left = (sp && sp.w ? sp.x - 5 : 0) + 'px';
      $.spot.style.top = (sp && sp.w ? sp.y - 5 - (sp.inMain ? twAt(m.scroll, t) : 0) : 0) + 'px';
      $.spot.style.width = (sp && sp.w ? sp.w + 10 : 0) + 'px';
      $.spot.style.height = (sp && sp.w ? sp.h + 10 : 0) + 'px';
      const v = m.vn, vOut = v ? clamp((t - v.t0 - v.dur) / .45, 0, 1) : 0;
      $.vn.style.opacity = v ? clamp((t - v.t0) / .16, 0, 1) * (1 - vOut) : 0;
      $.vn.style.transform = v ? `translateY(${(1 - eOut((t - v.t0) / .3)) * 26 - eIO(vOut) * 50}px) scale(${.9 + .1 * eBack((t - v.t0) / .34)})` : '';
      if (v && v.typed) typeOut($.vn.querySelector('span'), t, v.from, v.typed);

      /* the customer's phone */
      const cn = eOut((t - c.nav) / .3);
      $.custHost.style.opacity = .25 + .75 * cn;
      $.custHost.style.transform = c.view === 'page' ? `translateY(${(1 - cn) * 60}px)` : '';
      $.custHost.querySelectorAll('[data-in]').forEach(r => {
        const p = eOut((t - r.dataset.in) / .42);
        if (r.dataset.fx === 'pop') { r.style.opacity = p; r.style.transform = `scale(${.9 + .1 * eBack((t - r.dataset.in) / .42)})`; return; }
        r.style.gridTemplateRows = p + 'fr';
        const b = r.firstChild.lastChild;
        b.style.opacity = p;
        b.style.transform = `scale(${.86 + .14 * eBack((t - r.dataset.in) / .45)})`;
      });
      const callP = $.custHost.querySelector('[data-call]');
      if (callP) { const sec = c.live === null ? -1 : Math.floor(t - c.live); callP.textContent = sec < 0 ? 'Calling…' : '0:' + String(sec).padStart(2, '0'); }

      /* taps */
      [['tom', $.tom, m], ['cust', $.cust, c]].forEach(([who, node, st]) => {
        const dot = node.querySelector('.f-tap'), tp = st.tap, p = tp ? (t - tp.t0) / .5 : 2;
        const old = node.querySelector('.f-press');
        if (old) old.classList.remove('f-press');
        if (p < 0 || p > 1) { dot.style.opacity = 0; dot.style.transform = ''; return; }
        dot.style.opacity = p < .18 ? p / .18 : 1 - (p - .18) / .82;
        dot.style.transform = `translate(${tp.x}px,${tp.y}px) scale(${1.25 - .4 * eOut(p)})`;
        if (p > .1 && p < .62) { const target = node.querySelector('.f-screen').querySelector(tp.sel); if (target) target.classList.add('f-press'); }
      });

      /* the middle column */
      if (s.head) {
        /* the old line fades away as the new one comes up, so the column is never empty */
        $.head.firstChild.style.opacity = 1 - clamp((t - s.head.t0) / .16, 0, 1);
        $.head.lastChild.childNodes.forEach((line, i) => {
          const p = eOut((t - s.head.t0 - .16 - i * .09) / .5);
          line.style.opacity = p;
          line.style.transform = `translateY(${(1 - p) * 24}px)`;
        });
      }
      $.chap.style.opacity = eOut((t - s.chap.t0) / .5);
      $.listIn.querySelectorAll('.f-it').forEach(r => {
        const p = eOut((t - r.dataset.in) / .45);
        /* the newest line is the one to read; the ones before it step back */
        const back = r.dataset.next === '' ? 0 : eIO((t - r.dataset.next - .25) / .7);
        r.style.gridTemplateRows = p + 'fr';
        r.firstChild.style.opacity = p * mix(1, BACK, back);
        r.firstChild.firstChild.style.transform = `translateX(${(1 - p) * -26}px)`;
        if (r.dataset.typed) typeOut(r.querySelector('small'), t, +r.dataset.from, +r.dataset.typed);
      });
      const gone = s.old ? clamp((t - s.old.t0) / .3, 0, 1) : 1;
      $.listOld.style.opacity = 1 - gone;
      $.listOld.style.transform = `translateY(${-eOut(gone) * 16}px)`;
      $.listIn.querySelectorAll('[data-pop]').forEach(d => { const p = (t - d.dataset.pop) / .3; d.style.opacity = clamp(p * 2, 0, 1); d.style.transform = `scale(${p <= 0 ? 0 : eBack(p)})`; });
      const over = $.listIn.offsetHeight - $.list.clientHeight;
      $.listIn.style.transform = `translateY(${-Math.max(0, over)}px)`;
      $.list.classList.toggle('over', over > 2);
      const cap = showCaps ? caps.find(x => t >= x.t0 && t < x.t1) : null;
      const capText = cap ? cap.text : '';
      if ($.cap.dataset.t !== capText) { $.cap.dataset.t = capText; $.cap.innerHTML = capText ? `<span>${esc(capText)}</span>` : ''; }

      /* the opening and closing cards */
      const k = s.card;
      $.cardIn.style.opacity = k && k.name === 'in' ? (k.out ? 1 - eOut((t - k.out) / .5) : 1) : 0;
      if (k && k.name === 'in') {
        const kids = $.cardIn.children;
        /* the name and the first line are there from the first frame, so a still of it is never empty */
        [-2, -2, 1.3].forEach((d, i) => { const p = eOut((t - d) / .7); kids[i].style.opacity = p; kids[i].style.transform = `translateY(${(1 - p) * 26}px)`; });
      }
      const e = k && k.name === 'end' ? k.t0 : null;
      $.cardEnd.style.opacity = e === null ? 0 : 1;
      if (e !== null) Array.from($.cardEnd.children).forEach((kid, i) => { const p = eOut((t - e - [0, .35, 1.5, 2.3, 2.9][i]) / .7); kid.style.opacity = p; kid.style.transform = `translateY(${(1 - p) * 26}px)`; });
    }

    function seek(t) {
      cur = clamp(t, 0, DUR);
      let k = 0;
      for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].at <= cur) { k = i; break; }
      if (k !== lastK) { paint(snaps[k]); lastK = k; }
      frame(snaps[k], cur);
      if (!capture) ui();
    }
    const clockText = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    function ui() {
      const b = beats.find(x => cur < x.t1) || beats[beats.length - 1], i = beats.indexOf(b);
      $.seek.value = Math.round(cur / DUR * 1000);
      $.time.textContent = clockText(cur) + ' / ' + clockText(DUR);
      $.play.textContent = playing ? 'Pause' : cur >= DUR ? 'Play again' : 'Play';
      if ($.now.dataset.i !== String(i)) {
        $.now.dataset.i = i;
        $.now.innerHTML = `<b>Step ${i + 1} of ${beats.length}: ${esc(b.title)}</b><p>${esc(b.say)}</p>`;
        $.steps.querySelectorAll('button').forEach((btn, n) => { if (n === i) btn.setAttribute('aria-current', 'true'); else btn.removeAttribute('aria-current'); });
      }
    }
    function loop() {
      if (!playing) return;
      const t = startedFrom + (performance.now() - startedAt) / 1000;
      seek(t);
      if (t >= DUR) { playing = false; ui(); return; }
      raf = requestAnimationFrame(loop);
    }
    function play() { if (cur >= DUR) cur = 0; playing = true; startedAt = performance.now(); startedFrom = cur; cancelAnimationFrame(raf); loop(); }
    function pause() { playing = false; cancelAnimationFrame(raf); if ($) ui(); }
    function step(dir) {
      pause();
      const i = beats.findIndex(x => cur < x.t1 - .001);
      const to = dir > 0 ? beats[Math.min(beats.length - 1, i + 1)] : (cur - beats[i].t0 > 1 ? beats[i] : beats[Math.max(0, i - 1)]);
      seek(to.t0);
    }

    let fontsReady = false;
    function open(opts) {
      opts = opts || {};
      capture = !!opts.capture;
      if (opts.captions !== undefined) showCaps = !!opts.captions;
      if (S.sheet) closeSheet();
      if (!$) mount();
      build();
      caps = captions();
      $.hdTom.querySelector('small').textContent = APP.owner + ', the owner';
      $.rail.innerHTML = CHAPS.map(k => `<i><span><svg aria-hidden="true"><use href="#${SVC[k].icon}"></use></svg>${esc(SVC[k].label)}</span><em><b></b></em></i>`).join('');
      $.steps.innerHTML = beats.map((b, i) => `<li><button data-act="film-go" data-v="${i}"><time>${clockText(b.t0)}</time><span><b>${esc(b.title)}.</b> ${esc(b.say)}</span></button></li>`).join('');
      $.capsBtn.setAttribute('aria-pressed', String(showCaps));
      $.stage.classList.toggle('nocap', !showCaps);
      el.classList.toggle('capture', capture);
      app.hidden = true;
      el.hidden = false;
      document.documentElement.classList.add('film-on');
      window.scrollTo(0, 0);
      lastHTML = {}; lastK = -1; $.now.dataset.i = '';
      const ready = () => { fontsReady = true; fit(); measure(); seek(opts.at || 0); if (opts.play) play(); };
      if (document.fonts && document.fonts.ready && !fontsReady) return document.fonts.ready.then(ready);
      ready();
      return Promise.resolve();
    }
    function close() {
      pause();
      el.hidden = true;
      app.hidden = false;
      document.documentElement.classList.remove('film-on');
      if (location.hash === '#film') { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* the page still works */ } }
      render();
    }

    const calm = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
    ACT.film = () => { open({ play: !calm() }); const h = el.querySelector('#fl-film-h'); if (h) h.focus({ preventScroll: true }); };
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const a = b.dataset.act;
      if (a === 'film-play') { if (playing) pause(); else play(); }
      if (a === 'film-step') step(+b.dataset.v);
      if (a === 'film-go') { pause(); seek(beats[+b.dataset.v].t0); $.fit.scrollIntoView({ block: 'nearest' }); }
      if (a === 'film-caps') { showCaps = !showCaps; b.setAttribute('aria-pressed', String(showCaps)); $.stage.classList.toggle('nocap', !showCaps); seek(cur); }
      if (a === 'film-full') { try { const p = document.fullscreenElement ? document.exitFullscreen() : $.fit.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* not every viewer allows it */ } }
      if (a === 'film-close') close();
    });
    document.addEventListener('keydown', e => {
      if (el.hidden || !e.target.closest || e.target.closest('input,textarea')) return;
      if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); if (playing) pause(); else play(); }
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    });
    if (location.hash === '#film') open({});
    window.addEventListener('hashchange', () => { if (location.hash === '#film' && el.hidden) open({}); });

    return { open, close, seek, play, pause, get duration() { return DUR; }, get beats() { return beats; }, get cards() { return cards; }, captions: () => caps, get snaps() { return snaps; } };
  })();
  window.__flFilm = Film;
