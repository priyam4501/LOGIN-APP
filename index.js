import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import TwitterStrategy from "passport-twitter-oauth2.0";
import session from "express-session";
import env from "dotenv";
env.config();

const app = express();
const port = process.env.PORT;
const saltRounds = 10;

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: true,
    })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.get("/", (req,res)=>{
    res.render("form.ejs");
});

app.get("/error", (req,res)=>{
  if(req.isAuthenticated()== false){
    res.render("form.ejs", { error: "Incorrect Password" });
  }else{
    res.redirect("/");
  }
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});


app.get("/secrets", (req,res)=>{
    if(req.isAuthenticated()){
      res.render("secrets.ejs", { secrets: "You are logged in successfully" });
    }else{
        res.redirect("/");
    }
});

// Twitter authentication route
app.get(
  "/auth/twitter",
  passport.authenticate("twitter", {
    scope: ["tweet.read", "users.read", "offline.access"],
  })
);

app.get(
  "/auth/twitter/secrets",
  passport.authenticate("twitter", { failureRedirect: "/" }),
  function (req, res) {
    // Successful authentication, redirect home.
    res.redirect("/secrets");
  }
);

app.post("/login", 
    passport.authenticate("local", {
    successRedirect: "/secrets",
    failureRedirect: "/error",
  })
);

app.post("/register", async (req,res)=>{
    const { userid, password } = req.body;
    
    // Basic validation
    if (!userid || !password) {
        return res.render("form.ejs", { 
            error: "Email and password are required",
            activeTab: "signup"
        });
    }

    try {
        const checkResult = await db.query("SELECT * FROM users WHERE userid = $1", [userid]);

        if (checkResult.rows.length > 0) {
            return res.render("form.ejs", { 
                error: "User already exists - try logging in instead",
                activeTab: "login" 
            });
        }

        const hash = await bcrypt.hash(password, saltRounds);
        const result = await db.query(
            "INSERT INTO users (userid, password) VALUES ($1, $2) RETURNING *",
            [userid, hash]
        );
        
        const user = result.rows[0];
        req.login(user, (err) => {
            if (err) {
                console.error("Login error:", err);
                return res.render("form.ejs", {
                    error: "Error during login after registration",
                    activeTab: "login"
                });
            }
            return res.redirect("/secrets");
        });
    } catch (err) {
        console.error("Registration error:", err);
        res.render("form.ejs", {
            error: "Registration failed - please try again",
            activeTab: "signup"
        });
    }
});


passport.use("local", new Strategy({
    usernameField: 'userid',
    passwordField: 'password'
}, async (username, password, cb) => {
    try {
        const result = await db.query("SELECT * FROM users WHERE userid = $1", [username]);
        
        if (result.rows.length === 0) {
            return cb(null, false, { message: "User not found" });
        }

        const user = result.rows[0];
        const isValid = await bcrypt.compare(password, user.password);
        
        if (!isValid) {
            return cb(null, false, { message: "Incorrect password" });
        }

        return cb(null, user);
    } catch (err) {
        console.error("Login error:", err);
        return cb(err);
    }
}));


// Configure Twitter Strategy
passport.use(
  "twitter",
  new TwitterStrategy(
    {
      clientID: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
      callbackURL: process.env.TWITTER_CALLBACK_URL,
      clientType: "public",
      pkce: true,
      state: true,
      customHeaders: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
        ).toString("base64")}`,
      },
    },
    async function (accessToken, refreshToken, profile, cb) {
      try {
        // Create a consistent user object structure
        const user = {
          id: profile.id,
          username: profile.username || profile.email,
          provider: "twitter",
        };

        // Database operations remain unchanged
        const result = await db.query("SELECT * FROM users WHERE userid = $1", [
          user.username,
        ]);
        
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (userid, password) VALUES ($1, $2) RETURNING *",
            [profile.username, "twitter"]
          );
          user.dbRecord = newUser.rows[0]; // Attach DB record without modifying it
        } else {
          user.dbRecord = result.rows[0]; // Attach existing user record
        }

        return cb(null, user);
      } catch (err) {
        console.error("Twitter auth error:", err);
        return cb(err);
      }
    }
  )
);

passport.serializeUser((user, cb) => {
  // Store only essential user info in session
  cb(null, {
    id: user.id,
    username: user.username,
    provider: user.provider
  });
});

passport.deserializeUser((user, cb) => {
  // Return the same user object that was serialized
  cb(null, user);
});

app.listen(port, () =>{
    console.log(`Server is running on port ${port}`);
})
