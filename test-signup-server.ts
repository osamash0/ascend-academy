import dotenv from "dotenv";
dotenv.config();

async function testSignUp() {
  const { auth } = await import("./src/lib/better-auth.js");
  try {
    const res = await auth.api.signUpEmail({
      body: {
        email: "binsalah11@gmail.com",
        password: "StrongPassword123!",
        name: "Test User",
        role: "student"
      }
    });
    console.log("Response:", res);
  } catch (err) {
    console.error("SignUp Error:", err);
  }
}

testSignUp();
