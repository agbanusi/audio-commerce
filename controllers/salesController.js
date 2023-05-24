import Sales from "../models/SalesModel.js";
import GlobalError from "../utils/globalError.js";
import catchAsync from "../utils/catchAsyncError.js";
import emailSender from "../utils/emailSender.js";

import stripe from "stripe";
import dotenv from "dotenv";
dotenv.config();
const Stripe = stripe(process.env.STRIPE_SECRETE_KEY);
let saleData = undefined;

const createNewSale = async (data) => {
  const newSale = await Sales.create(data);

  return newSale;
};

export const newSale = catchAsync(async (req, res) => {
  const newSale = await createNewSale(req.body);

  res.status(200).json({
    status: "success",
    data: newSale,
  });
});

export const getSales = async (req, res) => {
  let {
    sortBy = "quantity",
    maxTotal = Infinity,
    minDate = new Date(0),
    maxDate = new Date(now()),
    page = 1,
  } = req.query;

  const aggregationPipeline = [
    {
      $match: {
        total: { $gte: minTotal, $lte: maxTotal },
        date: { $gte: minDate, $lte: maxDate },
      },
    },
    ...[
      {
        $sort: { [sortBy]: -1 },
      },
    ],
    { $skip: (page - 1) * 24 },
    { $limit: 50 },
    {
      $project: {
        convPrice: 0,
      },
    },
  ];
  const sales = (await Sales.aggregate(aggregationPipeline)) || [];

  res.status(200).json({
    status: "success",
    data: sales,
  });
};

export const stripePaymentIntent = async (req, res) => {
  saleData = req.body;

  const paymentIntent = await Stripe.paymentIntents.create({
    amount: saleData.total * 100,
    currency: "usd",
    automatic_payment_methods: {
      enabled: true,
    },
    shipping: {
      address: {
        city: saleData?.client?.city,
        country: saleData?.client?.country,
        line1: saleData?.client?.address,
        postal_code: saleData?.client?.zipCode,
      },
      name: saleData?.client?.name,
      phone: saleData?.client?.number,
    },
    receipt_email: saleData?.client?.email,
  });

  res.send({ clientSecret: paymentIntent.client_secret });
};

export const stripeWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];

  let event;
  try {
    event = Stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.NODE_ENV === "production"
        ? process.env.STRIPE_WEBHOOK
        : process.env.STRIPE_CLI
    );

    //
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).json({
      status: "failed",
      message: `Webhook signature verification failed.
      Error message: ${err.message}`,
    });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;

    createNewSale(saleData);

    emailSender(
      saleData.client.email,
      "Order Confirmation!",
      "Your order has been confirmed!",
      "<h1>Your order has been confirmed!</h1>"
    );

    saleData = undefined;

    console.log(`PaymentIntent for ${paymentIntent.amount} was successful!`);

    res.status(200).json({ status: "success" });
  }
};
