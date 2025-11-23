const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const { google } = require("googleapis");

const app = express();
app.use(bodyParser.json());
app.use(cors());

// ---------------- OAUTH 2.0 CONFIG ------------------

const CLIENT_ID = "86919650489-gs9ii2g2r6f7mpslg92c252809ekq1sf.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REDIRECT_URI = "https://zoho-backend-xkln.onrender.com/oauth2callback";

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

let gmailTokens = null;

// STEP 1: Generate OAuth URL
app.get("/auth-url", (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.send"]
  });

  res.json({ url });
});

// STEP 2: Google Redirect Handler
app.get("/oauth2callback", async (req, res) => {
  const code = req.query.code;

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    gmailTokens = tokens;

    fs.writeFileSync("gmail-tokens.json", JSON.stringify(tokens, null, 2));

    res.send("Gmail OAuth Successful! Tokens saved. You may close this window.");
  } catch (err) {
    console.error(err);
    res.send("OAuth Failed. Check console.");
  }
});

app.get("/debug/token", (req, res) => {
  try {
    const data = fs.readFileSync("gmail-tokens.json", "utf8");
    res.send(data);
  } catch (err) {
    res.send("Token file not found.");
  }
});

const path = require("path");

app.get("/debug/files", (req, res) => {
  try {
    const files = fs.readdirSync(path.resolve("./"));
    res.json({ files });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ---------------- GOOGLE CALENDAR (SERVICE ACCOUNT) ------------------

const calendarAuth = new google.auth.GoogleAuth({
  keyFile: "service-account.json",
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

// Create appointment event
app.post("/create-event", async (req, res) => {
  try {
    const { email, name, date, startTime, endTime, service } = req.body;

    const client = await calendarAuth.getClient();
    const calendar = google.calendar({ version: "v3", auth: client });

    const event = {
      summary: `Appointment: ${service}`,
      description: `Booked by ${name} (${email})`,
      start: { dateTime: `${date}T${startTime}:00+05:30` },
      end: { dateTime: `${date}T${endTime}:00+05:30` }
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event
    });

    res.json({
      success: true,
      eventId: response.data.id,
      message: "Event created successfully"
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// ---------------- GMAIL OAUTH EMAIL SENDER ------------------

app.post("/send-email", async (req, res) => {
  try {
    const { email, subject, message } = req.body;

    const tokens = JSON.parse(fs.readFileSync("gmail-tokens.json"));
    oAuth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const encodedMessage = Buffer.from(
      `To: ${email}\r\nSubject: ${subject}\r\n\r\n${message}`
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage
      }
    });

    res.json({ success: true, message: "Email sent successfully" });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});
// ---------------- MASTER ENDPOINT FOR ZOHO BOT ------------------

app.post("/book-appointment", async (req, res) => {
  try {
    const { name, email, date, startTime, endTime, service } = req.body;

    // 1️⃣ CREATE GOOGLE CALENDAR EVENT
    const client = await calendarAuth.getClient();
    const calendar = google.calendar({ version: "v3", auth: client });

    const event = {
      summary: `Appointment: ${service}`,
      description: `Booked by ${name} (${email})`,
      start: { dateTime: `${date}T${startTime}:00+05:30` },
      end: { dateTime: `${date}T${endTime}:00+05:30` }
    };

    const eventRes = await calendar.events.insert({
      calendarId: "primary",
      resource: event
    });

    // 2️⃣ SEND CONFIRMATION EMAIL
    const tokens = JSON.parse(fs.readFileSync("gmail-tokens.json"));
    oAuth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

    const encodedMessage = Buffer.from(
      `To: ${email}\r\nSubject: Appointment Confirmation\r\n\r\nHi ${name},\n\nYour appointment for ${service} is confirmed on ${date} from ${startTime} to ${endTime}.\n\nThank you!`
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedMessage }
    });

    // 3️⃣ SEND SUCCESS RESPONSE TO ZOHO BOT
    res.json({
      success: true,
      message: "Appointment booked successfully",
      eventId: eventRes.data.id
    });

  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// ---------------- SERVER ------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
