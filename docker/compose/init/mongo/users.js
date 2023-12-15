db.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
db = db.getSiblingDB('connections');
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