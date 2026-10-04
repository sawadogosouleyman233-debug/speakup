const express = require("express");
const fs = require("fs");
const API = "https://api-checkout.cinetpay.com/v2";
const { CINETPAY_API_KEY: KEY, CINETPAY_SITE_ID: SITE, BASE_URL, PORT = 3000 } = process.env;
const PLANS = { mensuel: { amount: 1500, days: 30 }, annuel: { amount: 8000, days: 365 } };
const DB = "data.json";
const load = () => { try { return JSON.parse(fs.readFileSync(DB)); } catch { return { users: {}, tx: {} }; } };
const save = d => fs.writeFileSync(DB, JSON.stringify(d, null, 1));

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));

// 1. Le client demande à payer
app.post("/api/pay", async (req, res) => {
  const phone = String(req.body.phone || "").replace(/\D/g, "");
  const plan = PLANS[req.body.plan];
  if (phone.length < 8 || !plan) return res.status(400).json({ error: "Numéro ou offre invalide" });
  const id = "SU" + Date.now() + Math.floor(Math.random() * 1000);
  const db = load(); db.tx[id] = { phone, plan: req.body.plan, done: false }; save(db);
  try {
    const r = await fetch(API + "/payment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: KEY, site_id: SITE, transaction_id: id, amount: plan.amount, currency: "XOF",
        description: "SpeakUp Premium " + req.body.plan, channels: "ALL",
        notify_url: BASE_URL + "/api/notify", return_url: BASE_URL + "/return",
        customer_id: phone, customer_name: "Client", customer_surname: "SpeakUp",
        customer_phone_number: phone, customer_email: "client@speakup.app",
        customer_address: "Abidjan", customer_city: "Abidjan", customer_country: "CI",
        customer_state: "CI", customer_zip_code: "00225"
      })
    });
    const j = await r.json();
    if (j.code !== "201") return res.status(502).json({ error: j.message || "Paiement indisponible" });
    res.json({ url: j.data.payment_url });
  } catch (e) { res.status(502).json({ error: "Service de paiement injoignable" }); }
});

// 2. CinetPay nous prévient : on VÉRIFIE auprès de CinetPay avant d'activer
app.post("/api/notify", async (req, res) => {
  const id = req.body.cpm_trans_id;
  const db = load(); const tx = db.tx[id];
  if (!tx || tx.done) return res.sendStatus(200);
  try {
    const r = await fetch(API + "/payment/check", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: KEY, site_id: SITE, transaction_id: id })
    });
    const j = await r.json();
    const plan = PLANS[tx.plan];
    if (j.code === "00" && j.data.status === "ACCEPTED" && Number(j.data.amount) === plan.amount) {
      const u = db.users[tx.phone] || {};
      const from = Math.max(Date.now(), u.premiumUntil || 0);
      db.users[tx.phone] = { premiumUntil: from + plan.days * 864e5 };
      tx.done = true; save(db);
    }
  } catch (e) {}
  res.sendStatus(200);
});

// 3. L'app demande si le numéro est Premium
app.get("/api/status", (req, res) => {
  const u = load().users[String(req.query.phone || "").replace(/\D/g, "")];
  res.json({ premium: !!u && u.premiumUntil > Date.now() });
});

app.all("/return", (req, res) => res.redirect("/?retour=1"));
app.listen(PORT, () => console.log("SpeakUp sur le port " + PORT));
