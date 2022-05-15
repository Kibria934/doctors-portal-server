const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion } = require("mongodb");
const { query } = require("express");
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

/* -------------- MY API COLLECTION---------- */
async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db("doctorsPortal").collection("services");
    const bookingCollection = client.db("doctorsPortal").collection("bookings");
    const userCollection = client.db("doctorsPortal").collection("users");

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query);
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
        res.send({ success: true, result });
      }
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

    app.get("/users", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    /*  ------------FOR ADMIN ----------- */

    app.put("/user/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        const filter = { email: email };
        const updatedDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      } else {
        res.status(403).send({ message: "Forbidden access" });
      }
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
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
