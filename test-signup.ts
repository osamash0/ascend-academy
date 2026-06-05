import { authClient } from "./src/lib/better-auth-client.js";

async function test() {
  console.log("Testing sign up...");
  try {
    const { data, error } = await authClient.signUp.email({
      email: "test_new_user_123@example.com",
      password: "Password123!",
      name: "Test User"
    });
    console.log("Data:", data);
    console.log("Error:", error);
  } catch (err) {
    console.error("Catch Error:", err);
  }
}

test();
