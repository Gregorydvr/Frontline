# The example app

This folder is the working design for the owner's app. It is a reference. Nothing in the real system imports from it, and nothing in here gets changed.

To use it, open `frontline-client-app.html` in a browser. It is one page with example data and nothing connected. "Play the example job" on Home plays one job from the first call to a service reminder a year later.

## What to take from it

- The look: colours, type, buttons and spacing, all in the `<style>` block of `src.html`.
- The layout of each screen, on a phone and from 960px wide.
- The wording.
- The checks: no sideways scroll, no button under 44px, no accessibility failures.

## What not to take

The screen code. Everything on screen is drawn from one object of hand-written example data. Dates are words ("Today", "Mon 12 Oct"). Amounts are whole pounds. Each customer has one job. Nothing can fail, so there are no screens for waiting or for something going wrong. The real screens are written again to read the record.

Two things in it are out of date: "Your rules" and the customer preview both say WhatsApp. Messages go by text from the firm's own number. See section 6 of `docs/build-brief.md`.

## The files

| File | What it is |
|---|---|
| `frontline-client-app.html` | The built page. Open this one |
| `src.html` | The app's source: the styles, the screens, the example data in `seed()`, and the things waiting for an OK in `review()` |
| `film.js`, `film.css` | The walkthrough film. `film.js` holds the example job's story: every message, date and figure. Section 7 of the build brief is its first chapter |
| `film_check.py` | Checks the story's dates, money and counts |
| `test.py` | Runs every flow at phone and laptop size |
| `axe_check.py` | Accessibility checks on every screen |
| `build.py` | Builds the page from the files above. `python3 build.py` prints a sha256 that starts `6e4ac5c9` |
| `font-face.css` | The Archivo font, as one 120 KB line. Search `src.html`, not the built page, or a match prints the whole font |
| `logo-paths.txt` | The front-line wordmark |

The three check scripts need Python with Playwright and a Chromium. They are not part of `npm run check`.

The firm, the people and the jobs are invented. The phone number on "Message us" is Front-line's own public number.
