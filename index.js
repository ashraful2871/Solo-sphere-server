const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const port = process.env.PORT || 5000;
const app = express();

const corsOptions = {
  origin: ["http://localhost:5173"],
  credentials: true,
  optionalSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jq7qb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: "unauthorized access" });
  jwt.verify(token, process.env.SECRET_KEY, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
  // next();
};

async function run() {
  try {
    const db = client.db("solo-DB");
    const jobsCollection = db.collection("jobs");
    const bidsCollection = db.collection("bids");

    //jwt token generate
    app.post("/jwt", async (req, res) => {
      const email = req.body;

      //create token
      const token = jwt.sign(email, process.env.SECRET_KEY, {
        expiresIn: "5h",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    //logout || clear cookie from browser
    app.get("/logout", async (req, res) => {
      res
        .clearCookie("token", {
          maxAge: 0,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    //save a jobData in db
    app.post("/add-jobs", async (req, res) => {
      const jobData = req.body;
      const result = await jobsCollection.insertOne(jobData);
      res.send(result);
    });

    //get all jobs posted specific user
    app.get("/jobs/:email", async (req, res) => {
      const email = req.params.email;
      const query = { "buyer.email": email };
      const result = await jobsCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/jobs", async (req, res) => {
      const result = await jobsCollection.find().toArray();
      res.send(result);
    });

    //delete database
    app.delete("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.deleteOne(query);
      res.send(result);
    });

    //get a single job data by db
    app.get("/job/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await jobsCollection.findOne(query);
      res.send(result);
    });

    //save update job
    app.put("/update-job/:id", async (req, res) => {
      const id = req.params.id;
      const jobData = req.body;
      const updateDoc = {
        $set: jobData,
      };
      const query = { _id: new ObjectId(id) };
      const option = { upsert: true };
      const result = await jobsCollection.updateOne(query, updateDoc, option);
      res.send(result);
    });

    //save a bidData in db
    app.post("/add-bid", async (req, res) => {
      const bidData = req.body;
      // if a user placed a bid already in this job
      const query = { email: bidData.email, jobId: bidData.jobId };
      const alreadyExist = await bidsCollection.findOne(query);
      console.log("already", alreadyExist);
      if (alreadyExist) {
        return res.status(400).send("You have already place in this job");
      }
      // save data in bidsCollection
      const result = await bidsCollection.insertOne(bidData);

      //increase bidCount in jobsCollection
      const filter = { _id: new ObjectId(bidData.jobId) };
      const update = {
        $inc: {
          bid_count: 1,
        },
      };
      const updateBidCount = await jobsCollection.updateOne(filter, update);

      res.send(result);
    });

    //get all bid for a specific user
    app.get("/bids/:email", verifyToken, async (req, res) => {
      const isBuyer = req.query.buyer;
      const email = req.params.email;
      const decodedEmail = req.user?.email;
      // console.log('email from token-->', decodedEmail)
      // console.log('email from params-->', email)
      if (decodedEmail !== email)
        return res.status(401).send({ message: "unauthorized access" });

      let query = {};
      if (isBuyer) {
        query.buyer = email;
      } else {
        query.email = email;
      }

      const result = await bidsCollection.find(query).toArray();
      res.send(result);
    });

    // //get all bid request for a specific user
    // app.get("/bid-requests/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const query = { buyer: email };
    //   const result = await bidsCollection.find(query).toArray();
    //   res.send(result);
    // });

    //update bid status
    app.patch("/bid-status-updated/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const filter = { _id: new ObjectId(id) };
      const updated = {
        $set: { status },
      };
      const result = await bidsCollection.updateOne(filter, updated);
      res.send(result);
    });

    //get all jobs
    app.get("/all-jobs", async (req, res) => {
      const filter = req.query.filter;
      const search = req.query.search;
      const sort = req.query.sort;

      let options = {};
      if (sort) {
        options = { sort: { deadline: sort === "asc" ? 1 : -1 } };
      }

      //search by input field
      let query = {
        title: {
          $regex: search,
          $options: "i",
        },
      };

      //filter by category
      if (filter) {
        query.category = filter;
      }
      const result = await jobsCollection.find(query, options).toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);
app.get("/", (req, res) => {
  res.send("Hello from SoloSphere Server....");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
