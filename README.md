# autodock-docker
The components necessary to build a docker container running an instance of 
autodock vina with its own HTTP API. You must have access to an AWS s3 Bucket
to successfully run. (This includes your own access key and secret access key)

### Contents

* [Setup & Run](#setup-run)
* [API Summary](#api-summary)
* [API Details](#api-details)


<a name="setup-run"></a>
### Setup & Run

#### Docker Desktop
Setting up to use AWS s3 functionality:
1. Obtain your access key and secret access key from your AWS organization.
2. Create a "config.json" file in the top level of this directory to contain your access key and secret access key.
    This is a json formatted file for example:
   ```{ "accessKeyId":"[ACCESS KEY]", "secretAccessKey": "[SECRET ACCESS KEY]", "region": "[AWS REGION]" }```
2. On your AWS account make sure you have access to your S3 bucket
3. In the index.js file, uncomment AWS.config.loadFromPath('./config.json');  towards the top of the file
4. Set the variable bucket = "<<Your s3 Bucket Name>>"
5. Create and Run Docker Image following steps below.

Next, build a docker image from the root directory of the autodock-docker
source code.



   ```docker image build -t [NAME OF YOUR IMAGE] [location of the autodock-docker directory]```

After the image has been generated, create a container. This container should
have port 8000 exposed.

   ```docker container run --publish [PORT ON MACHINE TO EXPOSE]:8000 --detach  --name [NAME OF YOUR IMAGE]```
    
Users can now interact with the instance of Autodock in the docker container. The following output should appear:

    ```
    > autodock@0.0.1 start /opt/autodock
    > node index.js

    Listening on port 8000.
    ```
    
When Deploying to AWS ECS Instance:
   Remove references to "config.json" file

<a name="api-summary"></a>
### API Summary

This briefly summarizes all API endpoints.

| HTTP Method | Endpoint | Function |
|:------------|:---------|:---------|
| POST | [/v1/autodock](#post) | Submits .pdbqt files and parameters and starts an autodock docking job |
| GET | [/v1/autodock](#get) | Returns a zip file of finished autodock job, or a "Job still proccessing" if the job has not yet completed |


<a name="api-details"></a>
### API Details

This outlines the API's endpoints, request types, and expected request parameters or JSON payload.

<a name="post"></a>
##### POST /v1/autodock
###### Submits .pdbqt files and parameters and starts an autodock docking job
 
Request body parameters (See http://vina.scripps.edu/manual.html#summary)

| Parameter | Type | Function |
|:----------|:-----|:---------|
| macromolecule | form data | A macromolecule file to be docked. A .pdbqt file is expected.
| ligand | form data | A ligand file to be docked. A .pdbqt file is expected.
| center_x | form data | X coordinate of the center. |
| center_y | form data | Y coordinate of the center. |
| center_z | form data | Z coordinate of the center. |
| size_x | form data | size in the X dimension |
| size_y | form data | size in the Y dimension |
| size_z | form data | size in the Z dimension |
| cpu | form data | the number of CPUs to use (the default is to try to detect the number of CPUs or, failing that, use 1) |
| seed | form data | explicit random seed |
| exhaustiveness | form data | exhaustiveness of the global search (roughly proportional to time): 1+ |
| num_modes | form data | maximum number of binding modes to generate |
| energy_range | form data | maximum energy difference between the best binding mode and the worst one displayed (kcal/mol) |




Output

Returns a jobId hash value which is used to retrieve the job once finished.  (status: 200)
If there is an error, returns an error message.

<a name="get"></a>
##### GET /v1/autodock
###### Retrieves autodock job file

Path parameters

| Parameter | Type | Function |
|:----------|:-----|:---------|
| jobId | String | A hash value identifying the autodock job to retrieve|

Output

If the job has completed an output.zip file is returned containing the docked macromolecule/ligand and the log.txt (status: 200)
If the job is not finished or does not exist, returns the message "Job still processing." (status: 200)
If the conversion was a failure an error.txt file is returned containing autodock output (status: 500)