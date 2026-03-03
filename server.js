const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

// Endpoint IPN PayDunya
app.post("/paydunya/ipn", async (req, res) => {
  const { status, reference } = req.body;

  if (status === "completed") {
    // Mise à jour de la commande Shopify
    await axios.put(
      `https://votre-boutique.myshopify.com/admin/api/2025-01/orders/${reference}.json`,
      { order: { financial_status: "paid" } },
      { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN }
      }
    );
  }

  res.sendStatus(200);
});

app.listen(3000, () => console.log("Serveur IPN actif"));
