### This is in case you're using the free tier on Render. It hosts and does mostly everything for me in my current setup for small groups.

### Step 1: Log in to Render

Go to your Render dashboard at dashboard.render.com.

### Step 2: Create a New PostgreSQL Database

1. On your dashboard, click the **New +** button and select  **PostgreSQL** .
2. Give your new database a unique name, for example, `paseito-db-2`.
3. Ensure the **Instance Type** is set to  **Free** .
4. Click the **Create Database** button at the bottom.

Render will now start provisioning your new database. This might take a minute or two.

### Step 3: Get the New Database URL

1. Once the new database's status is "Available", click on it to go to its dashboard page.
2. In the **Info** section, find the connection string labeled  **Internal Database URL** .
3. Click the copy button next to it. This is the new URL your application will use.

### Step 4: Update Your Application's Environment

1. Navigate back to your main dashboard and click on your `paseito` web service.
2. In the left-hand menu, go to the **Environment** tab.
3. Under "Environment Variables", find the key `DATABASE_URL`.
4. Click on the value field, delete the old URL, and paste the new **Internal Database URL** you just copied.
5. Click the **Save Changes** button.

### Step 5: Deploy and Verify

Saving the environment variable will automatically trigger a new deployment of your application. You'll see the deployment status at the top of the page.

Once the deployment is "Live", your application will be running and connected to the new, empty database. All new signs created in your world will be saved to this new database.

### Step 6: Delete the Old Database (Optional)

After you've confirmed everything is working, you can go back to your dashboard, find the old `paseito-db` database, go to its **Settings** page, and delete it to keep your dashboard clean.

Following these steps will get you a fresh, free database that won't expire for another 90 days, solving the problem without any code modifications.
