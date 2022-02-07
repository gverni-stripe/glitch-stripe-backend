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
  let result;
  if (paymentIntent.status === "requires_action") {
    result = {
      requires_action: true,
      secret: paymentIntent.clientSecret,
    };
  } else if (
    paymentIntent.status === "succeeded" ||
    (paymentIntent.status === "requires_capture" &&
      process.env["CAPTURE_METHOD"] === "manua")
  ) {
    result = { success: true };
  } else {
    result = "Invalid PaymentIntent status";
  }
  return result;
}

// Route used by android SDK
async function confirmPaymentIntent (req, res) => {
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

  let response = generatePaymentResponse(paymentIntent);

  res.status(typeof response === "string" ? 500 : 200).send(response);
}

module.exports = {
  confirmPaymentIntent
}