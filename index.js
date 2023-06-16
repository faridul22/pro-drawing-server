const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const app = express();
const port = process.env.PORT || 5000;


// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }

    // bearer token
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xwjksg9.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)

        const usersCollection = client.db("proDrawing").collection("users");
        const classesCollection = client.db("proDrawing").collection("classes");
        const selectedClassesCollection = client.db("proDrawing").collection("selectedclasses");
        const paymentsCollection = client.db("proDrawing").collection("payments");

        // jwt token
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token })
        })


        //----------------------Custom middleware-------------------

        // admin verify
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next();
        }

        // instructor verify
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }
            next();
        }



        //---------------------User collection apis------------------

        app.get('/users', verifyJWT, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result)
        })

        app.get('/instructors', async (req, res) => {
            const query = { role: "instructor" }
            const options = {
                sort: { "totalStudent": -1 }
            }
            const result = await usersCollection.find(query, options).toArray();
            res.send(result)
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "user already exist" })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })



        //----------------------Admin api----------------------

        // checkAdminRole 
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false })
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === 'admin' }
            res.send(result);
        })

        // checkInstructorRole
        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ instructor: false })
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { instructor: user?.role === 'instructor' }
            res.send(result);
        })



        //---------------------Manage user role----------------------

        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(query, updateDoc);
            res.send(result);
        })

        app.patch('/users/instructor/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'instructor'
                }
            }
            const result = await usersCollection.updateOne(query, updateDoc);
            res.send(result);
        })



        // -----------------------Public api---------------------

        app.get('/classes', async (req, res) => {
            const query = {}
            const options = {
                sort: { "totalStudent": -1 }
            }
            const result = await classesCollection.find(query, options).toArray();
            res.send(result)
        })

        app.get('/approvedclasses', async (req, res) => {
            const query = { status: "approved" }
            const options = {
                sort: { "totalStudent": -1 }
            }
            const result = await classesCollection.find(query, options).toArray();
            res.send(result)
        })



        //---------------------Instructor api------------------

        app.get('/myclasses', verifyJWT, verifyInstructor, async (req, res) => {
            const email = req.query.email;

            if (!email) {
                res.send([])
            }

            // check email
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                res.status(403).send({ error: true, message: 'forbidden access' });
            }


            const query = { instructorEmail: email };
            const result = await classesCollection.find(query).toArray();
            res.send(result)
        })

        app.get('/classes/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await classesCollection.findOne(query);
            res.send(result)
        })

        app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const newClass = req.body;
            const result = await classesCollection.insertOne(newClass);
            res.send(result);
        })

        // update class information
        app.patch('/classes/:id', async (req, res) => {
            const id = req.params.id;

            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true }
            const updatedClass = req.body;
            const updateInfo = {
                $set: {
                    className: updatedClass.className,
                    classImage: updatedClass.classImage,
                    availableSeats: updatedClass.availableSeats,
                    price: updatedClass.price
                }
            }
            const result = await classesCollection.updateOne(filter, updateInfo, options);
            res.send(result);
        })



        // ---------------------Admin api----------------------

        app.patch('/classes/approved/:id', async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: 'approved'
                }
            }
            const result = await classesCollection.updateOne(query, updateDoc);
            res.send(result);
        })

        app.patch('/classes/denied/:id', async (req, res) => {
            const id = req.params.id;

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: 'denied'
                }
            }
            const result = await classesCollection.updateOne(query, updateDoc);
            res.send(result);
        })
        app.patch('/classes/feedback/:id', async (req, res) => {
            const id = req.params.id;

            const filter = { _id: new ObjectId(id) }
            const options = { upsert: true }
            const updatedClass = req.body;
            const updateInfo = {
                $set: {
                    feedback: updatedClass.feedback
                }
            }
            const result = await classesCollection.updateOne(filter, updateInfo, options);
            res.send(result);
        })



        //----------------Student api---------------------

        app.get('/selectedclasses', verifyJWT, async (req, res) => {
            const email = req.query.email;

            if (!email) {
                res.send([])
            }

            // check email
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                res.status(403).send({ error: true, message: 'forbidden access' });
            }


            const query = { email: email };
            const result = await selectedClassesCollection.find(query).toArray();
            res.send(result)
        })

        app.get('/selectedclasses/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await selectedClassesCollection.findOne(query);
            res.send(result)
        })

        app.post('/selectedclasses', async (req, res) => {
            const selectedClasses = req.body;
            const result = await selectedClassesCollection.insertOne(selectedClasses)
            res.send(result)
        })

        app.delete('/selectedclasses/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await selectedClassesCollection.deleteOne(query);
            res.send(result)
        })

        app.get('/paymentData', verifyJWT, async (req, res) => {
            const email = req.query.email;

            if (!email) {
                res.send([])
            }

            // check email
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                res.status(403).send({ error: true, message: 'forbidden access' });
            }


            const query = { email: email };
            const options = {
                sort: { "date": -1 }
            }
            const result = await paymentsCollection.find(query, options).toArray();
            res.send(result)
        })



        // ---------------------------Payment--------------------------

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            })
        })


        // payment related apis
        app.post('/payments', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentsCollection.insertOne(payment);

            // delete from selected class
            const query = { _id: new ObjectId(payment.selectedClassId) }
            const deleteResult = await selectedClassesCollection.deleteOne(query);

            // update class information
            const filter = { _id: new ObjectId(payment.classId) }
            const availableSeats = payment.availableSeats;
            const totalStudent = payment.totalStudent;
            const options = { upsert: true };

            const updateDoc = {
                $set: {
                    availableSeats: availableSeats - 1,
                    totalStudent: totalStudent + 1,
                }
            }
            const updateResult = await classesCollection.updateOne(filter, updateDoc, options);

            const responseObj = {
                insertResult,
                deleteResult,
                updateResult
            };

            res.send(responseObj)
        })
        //----------------------End------------------------------


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send("Pro Drawing is Running")
})

app.listen(port, () => {
    console.log(`pro drawing server is running on port: ${port}`)
})