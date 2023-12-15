db.auth("admin-user", "admin-pass");
db = db.getSiblingDB("connections");
db.createUser(
  {
    user: "user",
    pwd: "pass",
    roles: [
      {
        role: "readWrite",
        db: "connections"
      }
    ]
  }
);