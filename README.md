[![Main](https://github.com/davictor24/truelayer-to-lunch-money/actions/workflows/main.yaml/badge.svg)](https://github.com/davictor24/truelayer-to-lunch-money/actions/workflows/main.yaml)


# TrueLayer to Lunch Money Importer
This project uses the [TrueLayer Data API](https://docs.truelayer.com/docs/data-api-basics) to connect to your bank and sync transactions to [Lunch Money](https://lunchmoney.app) using the [Lunch Money Developer API](https://lunchmoney.dev). 

This will be most useful to Lunch Money users based in Europe. Lunch Money offers Plaid integration, but it does not seem to support most banks in Europe.

### Architecture
This project has a frontend and two backend services -
- The frontend provides a user interface for managing bank connections with TrueLayer.
- The TrueLayer service periodically fetches transactions from TrueLayer and publishes them to a Kafka topic.
- The Lunch Money service listens to the Kafka topic and sends any new transactions to Lunch Money.

##### Dependencies
- The TrueLayer service depends on Mongo to persist and retrieve information on the bank connections added. 
- Both the TrueLayer and Lunch Money services depend on Kafka for sending/receiving messages regarding transactions to sync. 
- Kafka depends on Zookeeper for coordination.

(TODO: Architecture diagram)

### Things to note about TrueLayer setup
##### Environments
TrueLayer's live environment should be used if you want to link real bank accounts. However, they also offer a sandbox environment for testing purposes.
- Steps starting with **(sandbox)** should only be done if you intend to use the sandbox environment.
- Steps starting with **(live)** should only be done if you intend to use the live environment.
- Every other step should be done irrespective of using the sandbox or live environment.

##### Testing mode
TrueLayer offers unlimited free trial for its Data API in the live environment. However, when linking your bank account, you will see a "Testing mode active" banner at the top of the page (you will also see this banner in the sandbox environment).

If you want to deploy an an application that uses the TrueLayer API to other users, TrueLayer requires that you contact their sales team. However this is not required for personal use. Feel free to ignore the banner if running this project for personal use.

More information can be found [here](https://support.truelayer.com/hc/en-us/articles/360002087954-Does-TrueLayer-offer-a-trial-period-and-a-Sandbox-environment).

### Setting up a TrueLayer application
1. Create an account on https://console.truelayer.com.
2. A pop-up will appear asking you to create your first application. Enter an application name and a client ID. Don't download your client secret for now.
3. **(live)** Turn on the "LIVE" switch to the right of the navbar.
4. Go to the app settings using the left navigation.
5. Copy the generated client ID for your application.
6. Reset your client secret (using the red "refresh" button). Save the file containing the secret once it comes up for download.
7. Add http://localhost:8080/truelayer/redirect to the list of redirect URIs. As mentioned, it may take up to 15 minutes to take effect.

### Creating a Lunch Money access token
1. Go to https://my.lunchmoney.app/developers.
2. Enter a label for the access token (optional) and click "REQUEST NEW ACCESS TOKEN".
3. Copy the access token.

### Running the project
**Note:** Docker and Docker Compose are required.
1. Clone the repo and navigate to `docker/compose`.
2. Rename `env.txt` to `env.sh`.
3. Set the environment variables `TRUELAYER_CLIENT_ID`, `TRUELAYER_CLIENT_SECRET` and `LUNCH_MONEY_ACCESS_TOKEN` to their respective values.
4. Set the environment variables `TRUELAYER_STATE_SECRET`, `TRUELAYER_TOKEN_ENCRYPTION_SECRET` and `TRUELAYER_TOKEN_ENCRYPTION_SALT` to secure values of your choosing.
5. **(sandbox)** Set the `TRUELAYER_USE_SANDBOX` environment variable to `true`.
6. Run `source ./env.sh` to set the environment variables in the current shell.
7. Run `docker-compose -f common.yaml up --build` to start the containers.

### Adding bank connections
Wait for the containers to finish starting up.
1. Go to http://localhost:8000 on the host running the containers.
2. Click the `+` button to add a new connection.
3. Enter your desired name for the bank connection and click `Next`.
4. You will be redirected to TrueLayer. Follow the instructions to connect to your bank.
5. Once done, you will be redirected back to the frontend app, and your new bank connection will be shown on the list.

All the accounts in the bank connection will get added to Lunch Money automatically. The transactions for the past 30 days will also be added. 

### Managing bank connections
The sync will run once every 15 minutes to fetch any new transactions for all the connections. 

A larger sync job runs every day at 12am to fetch all transactions within the past 30 days in order to get previously pending transactions which have now cleared, or anything that might have been missed.

> ##### Note on pending transactions
> It would be ideal for pending transactions to be automatically updated when they clear. However, in a lot of cases, the transaction information and its external ID (`normalised_provider_transaction_id` from TrueLayer) change when a transaction clears. Thus there is usually not enough information to match a cleared transaction with a pending one in order for an update to be performed.
>  
> In addition, some transactions may never clear (e.g. if a purchase was cancelled, after some time the pending transaction will disappear without transitioning to a cleared transaction), but the Lunch Money Developer API does not support deleting transactions if this is observed.
> 
> The current solution is to insert pending transactions into an autogenerated "Pending" category which will not appear in the budget or totals. Once cleared, another transaction record is created, which can then be properly categorised. 
> 
> Open to suggestions/PRs if there is a better approach.

Several actions can also be performed on a connection from the UI -
- **Sync -** Performs a sync of all transactions within the past 30 days.
- **Authenticate -** Required every 90 days to maintain a connection with the bank.
- **Disconnect -** Deletes the connection. The accounts and transactions on Lunch Money will remain.

As mentioned the `+` button on the main screen adds a new connection. The "sync" button performs a sync of all transactions within the past 30 days for all connections.

### Deploying
Running the app using Docker Compose should be good enough for most use cases. However, the Docker images are also built and pushed to [Docker Hub](https://hub.docker.com/u/lunchmoneysync) for deployment through other means e.g. Kubernetes. I personally have the project running on a Kubernetes cluster in my home lab (K3s on Raspberry Pis).