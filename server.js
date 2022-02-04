const express = require("express");
const app = express();
const { resolve } = require("path");
// Replace if using a different env file or config
const env = require("dotenv").config({ path: "./.env" });

var morgan = require("morgan");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2020-08-27",
  appInfo: {
    // For sample support and debugging, not required for production:
    name: "stripe-samples/accept-a-payment/custom-payment-flow",
    version: "0.0.2",
    url: "https://github.com/stripe-samples",
  },
});

const emojiStore = {
  "👕": 2000,
  "👖": 4000,
  "👗": 3000,
  "👞": 700,
  "👟": 600,
  "👠": 1000,
  "👡": 2000,
  "👢": 2500,
  "👒": 800,
  "👙": 3000,
  "💄": 2000,
  "🎩": 5000,
  "👛": 5500,
  "👜": 6000,
  "🕶": 2000,
  "👚": 2500,
};

const countryCurrency = {
  us: "usd",
  mx: "mxd",
  my: "myr",
  at: "eur",
  be: "eur",
  de: "eur",
  es: "eur",
  it: "eur",
  nl: "eur",
  pl: "eur",
  au: "aud",
  gb: "gbp",
  in: "inr",
};

const paymentMethodForCountry = {
  us: ["card"],
  mx: ["card", "oxxo"],
  my: ["card", "fpx", "grabpay"],
  nl: ["card", "ideal", "sepa_debit", "sofort"],
  au: ["card", "au_becs_debit"],
  gb: ["card", "paypal", "bacs_debit"],
  es: ["card", "paypal", "sofort"],
  it: ["card", "paypal", "sofort"],
  pl: ["card", "paypal", "p24"],
  be: ["card", "paypal", "sofort", "bancontact"],
  de: ["card", "paypal", "sofort", "giropay"],
  at: ["card", "paypal", "sofort", "eps"],
  sg: ["card", "alipay", "grabpay"],
  in: ["card", "upi", "netbanking"],
};

app.use(express.static(process.env.STATIC_DIR));
app.use(
  express.json({
    // We need the raw body to verify webhook signatures.
    // Let's compute it only when hitting the Stripe webhook endpoint.
    verify: function (req, res, buf) {
      if (req.originalUrl.startsWith("/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);
app.use(morgan("tiny"));

app.get("/", (req, res) => {
  const path = resolve(process.env.STATIC_DIR + "/index.html");
  res.sendFile(path);
});

app.get("/config", (req, res) => {
  res.send({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
});

// TODO: Move this somewhere else
function priceLookup(product) {
  // TODP: Error handling
  return emojiStore[product];
}

function calculatePrice(products, shipping) {
  let amount = 1099;
  if (products) {
    amount = products.reduce((total, curr) => total + curr, 0);
  }

  if (shipping) {
    switch (shipping) {
      case "fedex":
        amount += 599;
        break;
      case "fedex_world":
        amount += 2099;
        break;
      case "ups_worldwide":
        amount += 1099;
        break;
    }
  }

  return amount;
}

function generatePaymentResponse(paymentIntent) {
  let result
  if (paymentIntent.status === 'requires_action') {
    result = {
      requires_action: true, 
      secret: paymentIntent.clientSecret
    }
  } else if (paymentIntent.status === 'succeeded' || (paymentIntent.status === 'requires_capture' && process.env["CAPTURE_METHOD"] === 'manua')) {
    result = {success: true}
  } else {
    result = "Invalid PaymentIntent status"
  }
  return result 
}

// Route used by android SDK
app.post("/confirm_payment_intent", async (req, res) => {
  const paymentIntentId = req.body["payment_intent_id"];
  const paymentMethodId = req.body["payment_method_id"];

  if (paymentIntentId) {
    await stripe.paymentIntents.confirm(paymentIntentId);
  } else if (paymentMethodId) {
    let amount = calculatePrice(req.body.products, req.body.shipping);
    let paymentIntent = await stripe.paymentIntent.create({
      amount,
      currency: countryCurrency(req.body.country) || "usd",
      customer: req.body["customer_id"], //TODO: see https://github.com/stripe/example-mobile-backend/blob/9a3a4705109b2c979cb0ea19effbcec34f3deaad/web.rb#L187
      source: req.body.source,
      paymentMethod: paymentMethodId,
      paymentMethodTypes: paymentMethodForCountry(req.body.country) || ["card"],
      description: "Example Payment Intent from gverni-stripe-backend",
      shipping: req.body.shipping,
      returnUrl: req.body["return_url"],
      confirm: true,
      confirmationMethod: "manual",
      useStripeSdk: true,
      captureMethod: process.env["CAPTURE_METHOD"] || "automatic",
      metadata: {
        orderId: "5278735C-1F40-407D-933A-286E463E72D8",
      },
    });
  }
  
  let response = generatePaymentResponse(paymentIntent)
  
  res.status(typeof response === 'string' ? 500 : 200).send(response)

});



// The route create_payment_intent is used by android SDK Example: https://github.com/stripe/stripe-android
// The route create-payment-intent is used by the `accept-a-payment example`
app.post(
  ["/create-payment-intent", "/create_payment_intent"],
  async (req, res) => {
    const { paymentMethodType, currency } = req.body;

    // Each payment method type has support for different currencies. In order to
    // support many payment method types and several currencies, this server
    // endpoint accepts both the payment method type and the currency as
    // parameters.
    //
    // Some example payment method types include `card`, `ideal`, and `alipay`.
    const params = {
      payment_method_types: [paymentMethodType],
      amount: 1999,
      currency: currency || "gbp", // The Android SDK example does not send any currency
    };

    // If this is for an ACSS payment, we add payment_method_options to create
    // the Mandate.
    if (paymentMethodType === "acss_debit") {
      params.payment_method_options = {
        acss_debit: {
          mandate_options: {
            payment_schedule: "sporadic",
            transaction_type: "personal",
          },
        },
      };
    }

    // Create a PaymentIntent with the amount, currency, and a payment method type.
    //
    // See the documentation [0] for the full list of supported parameters.
    //
    // [0] https://stripe.com/docs/api/payment_intents/create
    try {
      const paymentIntent = await stripe.paymentIntents.create(params);

      // Send publishable key and PaymentIntent details to client
      res.send({
        clientSecret: paymentIntent.client_secret,
        secret: paymentIntent.client_secret,
        id: paymentIntent.id,
        status: paymentIntent.status
      });
    } catch (e) {
      return res.status(400).send({
        error: {
          message: e.message,
        },
      });
    }
  }
);

// Expose a endpoint as a webhook handler for asynchronous events.
// Configure your webhook in the stripe developer dashboard
// https://dashboard.stripe.com/test/webhooks
app.post("/webhook", async (req, res) => {
  let data, eventType;

  // Check if webhook signing is configured.
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers["stripe-signature"];
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // we can retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  if (eventType === "payment_intent.succeeded") {
    // Funds have been captured
    // Fulfill any orders, e-mail receipts, etc
    // To cancel the payment after capture you will need to issue a Refund (https://stripe.com/docs/api/refunds)
    console.log("💰 Payment captured!");
  } else if (eventType === "payment_intent.payment_failed") {
    console.log("❌ Payment failed.");
  }
  res.sendStatus(200);
});

// Glitch is serving from port 3000
app.listen(3000, () =>
  console.log(`Node server listening at http://localhost:3000`)
);
