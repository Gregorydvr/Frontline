# When a firm leaves

When a firm leaves, its records are handed over as a file and deleted within 30 days (`docs/decisions.md`). Front-line does its part in the control room. Some of what a firm has sits outside this repository, with Twilio and Vapi. Those parts are steps for Greg, done by hand.

## In the control room

1. Open the firm's page and press **This firm is leaving**. Type the firm's name as it is held.
   - The stop button goes on, every service goes off, and every text still waiting is cancelled.
   - Its calls and texts are no longer kept: its number finds no firm.
   - Its export is made within a minute or two.
   - It is deleted by the clock 30 days from now. The firm's page counts the days down.
2. Under **The firm's records**, press **Download** on the export once it is made. It is a zip: spreadsheets of customers, jobs, visits, calls, texts and history, everything as `everything.json`, and the recordings still kept. Send it to the owner. Front-line keeps it until the firm is deleted, and never more than 30 days.
3. Once the owner has it, you can press **Delete the firm now** and type its name again. Or leave it: the clock deletes it at the end of the 30 days, whether or not the export was downloaded.

If the firm stays after all, press **Cancel the leaving** before it is deleted. Its services and stop button stay as they are: switch them back on yourself.

Once deleted, nothing of the firm is left in the database or the file stores, apart from the staff log and a note that the firm was deleted and when, both by id only. The database's restore points hold it for up to 30 more days (`docs/restore.md`).

## Outside this repository

Do these on your own machine, after the firm is deleted:

1. **Twilio.** The firm's number is registered in its name. Port it out to the firm if they want to keep it; otherwise release it. In Twilio's console, delete that number's message logs and their bodies. Check that no call recordings are held with Twilio for that number (Twilio's own recording should be off).
2. **Vapi.** Delete the firm's assistant, and remove its phone number from Vapi. Delete the firm's calls in Vapi (their transcripts, numbers and summaries). Check its recording path in the inbox file store, `firms/<the firm's id>/`, is empty: the Worker empties it when the firm is deleted, and the inbox's own rule deletes anything left after a day.
3. **The export file.** Once the firm has it, delete it from wherever you sent it from, such as your sent email.
4. **Cloudflare.** Nothing for each firm. Worker logs (ids only) and the database's restore points drop out by themselves.
