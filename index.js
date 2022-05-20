const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const sgTransport = require("nodemailer-sendgrid-transport");
const { MongoClient, ServerApiVersion, ObjectId, Transaction } = require("mongodb");
const { query } = require("express");
const stripe = require('stripe')('sk_test_51L188zJgDDR6frswLiDCfREpKky9BXycvX8r6Sztft4k3ZfzsrWDfYKVzQM2G3XkHceibeFyfsovMyZtEx9u54Bk00PtCbfA2Z');
require("dotenv").config();
const port = process.env.PORT || 5000;

//----middle ware----
app.use(cors());
app.use(express.json());

/* ----------CONNECT TO MONGODB----------- */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.frlxh.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

/* ----------------- TOKEN VERIFY -------------- */
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    } else {
      req.decoded = decoded;
      next();
    }
  });
};

/* -------------- SEND EMAIL WITH NODEMAIERSENDGRID ------------- */

const emailSenderOption = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY,
  },
};
const emailClient = nodemailer.createTransport(sgTransport(emailSenderOption));

// ---------- appointment confirmation email send -----------------
function appointmentEmail(booking) {
  const { treatment, date, slot, patient, patientName } = booking;
  var email = {
    from: process.env.EMAIL_SENDER,
    to: `${patient}`,
    subject: `Your appointment for ${treatment} is on ${date} at ${slot} is confirm`,
    text: `Your appointment for ${treatment} is on ${date} at ${slot} is confirm`,
    html: `
    <div>
    <p>Hello ${patientName}</p>
    <h3>Your appointment for ${treatment} is confirm.</h3>
    <p>Looking forward to seeing you on  ${treatment} is confirm.</p>
    <h3>Our address:</h3>
    <p>Dhaka,Bangladesh</p>
    </div>
    `,
  };
  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent: ", info);
    }
  });
}

// ---------- Payment confirmation email send -----------------
function paymentEmail(booking) {
  const { treatment, date, slot, patient, patientName,transactionId } = booking;
  var email = {
    from: process.env.EMAIL_SENDER,
    to: `${patient}`,
    subject: `We have received your payment for ${treatment} is on ${date} at ${slot} is confirm`,
    text: `Your payment for this ${treatment} is on ${date} at ${slot} is confirm`,
    html: `
    <div>
    <p>Hello ${patientName}</p>
    <p>Thank you for your payment</p>
    <h3>We have received your payment</h3>
    <p>Looking forward to seeing you on  ${treatment} is confirm.</p>
    <p>Your transection id ${transactionId}</p>
    <h3>Our address:</h3>
    <p>Dhaka,Bangladesh</p>
    </div>
    `,
  };
  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent: ", info);
    }
  });
}

async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db("doctorsPortal").collection("services");
    const bookingCollection = client.db("doctorsPortal").collection("bookings");
    const userCollection = client.db("doctorsPortal").collection("users");
    const paymentCollection = client.db("doctorsPortal").collection("payment");
    const doctorCollection = client.db("doctorsPortal").collection("doctors");

    /* ---------------- VERIFY ADMIN --------------- */
    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden access" });
      }
    };
    /* -------------- MY API COLLECTION---------- */
    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exist = await bookingCollection.findOne(query);
      if (exist) {
        res.send({ success: false, booking: exist });
      } else {
        const result = await bookingCollection.insertOne(booking);
        appointmentEmail(booking);
        res.send({ success: true, result });
      }
    });

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const service = req.body;
      const price = service.price;
      
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.get("/available", async (req, res) => {
      const date = req.query.date;

      /* ======== STEP-1: GET ALL DATA ========== */
      const services = await serviceCollection.find().toArray();
      /* ========= STEP-2: GET AVAILABLE BOOKING DATA ======= */
      const query = { date: date };
      const booking = await bookingCollection.find(query).toArray();
      services.forEach((service) => {
        const serviceBooking = booking.filter(
          (book) => book.treatment === service.name
        );
        const booked = serviceBooking.map((s) => s.slot);
        const available = service.slots.filter((s) => !booked.includes(s));
        service.slots = available;
      });
      res.send(services);
    });

    /*  ------- FOR DASHBOARD  DATA ----------- */
    app.get("/bookings", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;

      if (decodedEmail === patient) {
        const query = { patient: patient };
        const result = await bookingCollection.find(query).toArray();
        return res.send(result);
      } else {
        return res.status(403).send({ message: "Forbidden access" });
      }
    });

    app.get("/bookings/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const result = await bookingCollection.findOne(query);
      res.send(result);
    });
app.patch('/bookings/:id',verifyJWT,async(req,res)=>{
  const id = req.params.id;
  const payment = req.body;
  const filter = {_id:ObjectId(id)};
  updatedDoc={
    $set:{
      paid:true,
      transactionId:payment.transactionId,
    }
  }
  const result = await paymentCollection.insertOne(payment);
  const updateBooking = await bookingCollection.updateOne(filter,updatedDoc);
  const booking = await bookingCollection.findOne(filter)
  paymentEmail(booking)
  res.send(updateBooking);
})


    app.get("/users", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    /*  ------------FOR ADMIN ----------- */

    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });
    /* ---------------- DOCTOR API ----------------- */
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await doctorCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/doctor", async (req, res) => {
      const result = await doctorCollection.find().toArray();
      res.send(result);
    });

    /* -------- FOR USER INDENTIFY ---------- */
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN, {
        expiresIn: "1h",
      });
      res.send({ result, token });
    });
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

/* -------------- SIMPLE CHEAKING------------- */
app.get("/", (req, res) => {
  res.send("Hello from doctors portal");
});

app.listen(port, () => {
  console.log(`doctors app listening on port ${port}`);
});
