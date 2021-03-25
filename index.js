const express = require('express');
const crypto = require('crypto');

var exec = require('child_process').execFile;
const app = express();
var formidable = require('formidable');
var fs = require('fs-extra');
var archiver = require('archiver')
var path = require('path');


var AWS = require('aws-sdk');
//UNCOMMENT FOR LOCAL Development/testing ADD config.json file with your AWS access and secret key here 
//AWS.config.loadFromPath('./config.json');
var s3 = new AWS.S3({apiVersion: '2006-03-01'});

const bucket = 'autodock'; //change this to the name of the s3 bucket you are using
var lookedForOutput = false;
var lookedForError = false;
app.use(express.json())

const REQUIRED_FIELDS = ["center_x","center_y","center_z","size_x","size_y","size_z"];
const OPTIONAL_FIELDS = ["cpu", "seed", "exhaustiveness", "num_modes", "energy_range"];

const findKey = function(key, callback) {
    //console.log('Find Key');
    var params = {
    Bucket: bucket, 
    MaxKeys: 100
    };
    s3.listObjectsV2(params, function(err, data) {
        if (err) {
            console.log('Error in Find Key', err);
            return callback(err, null); // an error occurred how to return an error?
        }
        else {
            
            var found = false;
        //aws doesn't do file/folder structure it's just a list of things in the bucket
            data['Contents'].map(obj => { 
                if(obj.Key == key) { 
                    console.log(obj.Key, key, 'Key matches and is found');
                    found = true;
                    return callback(null, true);
                }
         });
         if(found == false) {
            console.log('Key doesnt match anything');
            return callback(null, null); //file doesn't exist
         } else{ 
             return;
         }
        }
    });
};

app.get('/v1/autodock', (req, res) => {
    let responseSent = false;
    //console.log('Get Data');
    console.log(req.query.jobId);
    if (!req.query.jobId) {
        console.log('Missing parameter of the jobId');
        res.status(400);
        responseSent = true;
        return res.send('Missing required parameter: jobId');
    }
    let key = '/opt/autodock/uploads/' + req.query.jobId + '/output.zip';
    console.log('Key', key);
    findKey(key, (err, data) => {
        if(err != null) {
            //error trying to find the job
            console.log('Find Key Exists Errored: ', err);
            if(!responseSent) {
                res.status(500);
                return res.send(err);
            } else {
                return;
            }
        } else if(err == null && data == null) {
            //lookedForError = true;
            console.log('Looking for Error file');
            //file not found, look for error file, if can't find error, return job still processing
            const errorPath = '/opt/autodock/uploads/'+ req.query.jobId + '/error.txt'
            findKey(errorPath, (err, exists) => {
                if(exists && !responseSent) {
                    console.log('error file exists');
                    let output = null;
                    var s3Output = s3.getObject({ Bucket: bucket, Key: errorPath }, function(err, data) { 
                        if(err) {
                            console.log(err);
                            if(!responseSent) {
                                res.status(500);
                                res.send("Could not retrieve Error from storage: "+err);
                            }
                        } 
                    }).createReadStream();
                    res.writeHead(400, {
                        'Content-Type': 'application/zip'
                    });
                    s3Output.pipe(res);
                    responseSent = true;
                } else if(err) {
                    if(!responseSent) {
                        console.log(err);
                        res.status(500);
                        responseSent = true;
                        return res.send("Could not retrieve Error Message from Storage. See the S3 Bucket for details");
                    }
                } else {
                    if(!responseSent) {
                        res.status(200);
                        responseSent = true;
                        return res.send('Job still processing.');
                    }
                }
            });
        } else if(lookedForOutput == false) { 
            console.log('Found the response');
            lookedForOutput = true;
            try{
                //trying to read the job
                let output=null;
                output = s3.getObject({ Bucket: bucket, Key: key }).createReadStream().on('error', err => {
                    console.log(err);
                    if(!responseSent) {
                        res.status(500);
                        responseSent =true;
                        return res.send("Could not retrieve job from storage: " + err);
                    } else {
                        return;
                    }
                });
                //console.log(res);
                //return success code 200, with a zip file of the response from the storage  
                res.writeHead(200, {
                  'Content-Type': 'application/zip'
                });
                output.pipe(res);
                responseSent = true;
                return;
              } catch(err) {
                console.log('Error retriving job', err);
                    if(!responseSent) {
                        res.status(500);
                        return res.send("Could not retrieve job from storage: "+err);
                    }
              }
            
        }
    });
});


app.post('/v1/autodock', (req, res) => {
    var ligand = null;
    var macromolecule = null;
    var fields = {};
    var errorMsg = "";
    var jobId = crypto.createHmac('SHA256', crypto.randomBytes(48))
    .update(Date.now()
    .toString())
    .digest('hex');
    var uploadDirectory = __dirname + '/uploads/' + jobId;
    let responseSent = false;
    ///opt/autodock
    //make a directory for the jobId
    if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory);
    }
    else {
        errorMsg = 'Hash collision.';
        res.status(500)
        return res.send(errorMsg)
    }
    var form = new formidable.IncomingForm();
    form.multiples = true;
    form.parse(req);
    form.on('field', function(name, value) {
        fields[name] = value
    })
    form.on('fileBegin', function (uploadDirectoryClosure) {return function (name, file){
        if (fs.existsSync(uploadDirectoryClosure + name + '.pdbqt')) {
            errorMsg = 'Multiple files with same name uploaded?';
        }
        if (name == 'ligand') {
            ligand = file.name        
            file.path = uploadDirectoryClosure + '/' + 'ligand.pdbqt';
        }
        else if (name == 'macromolecule') {
            macromolecule = file.name
            file.path = uploadDirectoryClosure + '/' + 'macromolecule.pdbqt';
        }
        else {
            errorMsg = 'Unknown file name parameter: ' + name;
        }

    }}(uploadDirectory));

    if (errorMsg) {
        res.status(400);
        return res.send(errorMsg);
    }

    form.on('end', function (uploadDirectoryClosure, jobIdClosure) {
        return function() {
        try {
            args = 
            ['--receptor', uploadDirectoryClosure + '/macromolecule.pdbqt',  
            '--ligand', uploadDirectoryClosure + '/ligand.pdbqt',
            '--log', uploadDirectoryClosure + '/log.txt'];
            
            // Make sure there are no required arguments missing
            let missingParameters = REQUIRED_FIELDS.filter(field => !(field in fields));
            if (missingParameters.length>0) {
                throw `Missing required parameters: ${missingParameters.join()}`;
            }

            // Make sure that any extra parameters are valid optional arguments, for testing or validation
            let unknownParameters = Object.keys(fields).filter(field => !([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].includes(field)));
            if (unknownParameters.length>0) {
                throw `Unknown parameters: ${unknownParameters.join()}`;
            }

            // Add parameters to arguments list
            Object.keys(fields).forEach(field => {
                args.push("--"+field, fields[field])
            });
        }
        catch(err) {
            errorMsg = `Incorrect arguments provided: ${err}`;
            res.status(400)
            return res.send(errorMsg)
        }

        try {
            exePath = path.resolve(__dirname, './vina');
            console.log('Running VinaLC');
            exec(exePath, args, {timeout: 900000}, function(error, stdout, stderr) {
                jobUploadCallback = function (err) {
                    //only when error occurs
                    if (err) {
                        console.log(err);
                        let errorWriteStream = fs.createWriteStream(uploadDirectoryClosure + '/error.txt');
                        errorWriteStream.write(err);
                        errorWriteStream.close();
                        errorWriteStream.on('close', ()  => {
                            let readStream = fs.createReadStream(uploadDirectoryClosure+ '/error.txt');
                            var uploadParams = {Bucket: bucket, Key: uploadDirectoryClosure + '/error.txt', Body: readStream};
                            s3.upload(uploadParams, function(err, data) {
                                if(err) {
                                    res.status(400);
                                    return res.send('Error on Docking and could not upload Error' + err);
                                } else {
                                    console.log('Success uploading error')
                                    fs.remove(uploadDirectoryClosure);
                                }
                            });
                        });
                    }
                    else {
                        console.log('Successful docking, removing directory')
                        //on success of the execute
                        //remove docker.local upload directory
                        fs.remove(uploadDirectoryClosure);
                    }
                };
                console.log('after the vinalc call');

                if (stderr) {
                    jobUploadCallback(stderr);
                }
                else if (error) {
                    jobUploadCallback(error.toString());
                }
                else {
                    //success of the docking
                    console.log('Successful docking, uploading to zip');
                    var outputPath = uploadDirectoryClosure + '/output.zip';
                    var output = fs.createWriteStream(outputPath);
                    var archive = archiver('zip', {
                        zlib: { level: 9 }
                    })
                    //write the output zip file
                    output.on('close', function () {
                        let readStream = fs.createReadStream(outputPath);
                        var uploadParams = {Bucket: bucket, Key: outputPath, Body: readStream};
                        s3.upload (uploadParams, function (err, data) {
                            if (err) {
                              console.log("Error", err);
                            } if (data) {
                              console.log("Upload Success", data.Location);
                            }
                          });
                    })
                    archive.on('error', jobUploadCallback);
                    archive.pipe(output);
                    var results = uploadDirectoryClosure + '/ligand_out.pdbqt';
                    archive.append(fs.createReadStream(results), { name: 'ligand_out.pdbqt' });
                    var log = uploadDirectoryClosure + '/log.txt';
                    archive.append(fs.createReadStream(log), { name: 'log.txt' });
                    archive.finalize();

                }});
                var response = {
                    'jobId': jobId,
                    'macromolecule': macromolecule,
                    'ligand': ligand
                }
                res.status(200);
                res.send(response);
            }
            catch(error) {
                errorMsg = 'Execution error: ' + error;
                res.status(500)
                return res.send(errorMsg)
        }
    }}(uploadDirectory, jobId));

});

app.listen(8000, () => {
    console.log('Listening on port 8000.')
})