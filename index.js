const express = require('express');
const crypto = require('crypto');
const {Storage} = require('@google-cloud/storage');
var exec = require('child_process').execFile;
const app = express();
var formidable = require('formidable');
var fs = require('fs-extra');
var archiver = require('archiver')
var path = require('path');
app.use(express.json())

const REQUIRED_FIELDS = ["center_x","center_y","center_z","size_x","size_y","size_z"];
const OPTIONAL_FIELDS = ["cpu", "seed", "exhaustiveness", "num_modes", "energy_range"];

app.get('/v1/autodock', (req, res) => {
    const storage = new Storage();
    if (!req.query.jobId) {
        res.status(400);
        return res.send('Missing required parameter: jobId');
    }
    return storage
        .bucket('autodock-production')
        .file(req.query.jobId + '/output.zip')
        .exists((err, exists) => {
            if (err) {
                res.status(400);
                return res.send('Error retrieving file from storage.');
            }
            else if (exists) {
                return storage
                    .bucket('autodock-production')
                    .file(req.query.jobId + '/output.zip')
                    .createReadStream()
                    .pipe(res);
            }
            else {
                storage
                .bucket('autodock-production')
                .file(req.query.jobId + '/error.txt')
                .exists((err, exists) => {
                    if (err) {
                        res.status(400);
                        return res.send('Error retrieving file from storage.');
                    }
                    else if (exists) {
                        return storage
                            .bucket('autodock-production')
                            .file(req.query.jobId + '/error.txt')
                            .createReadStream()
                            .pipe(res);
                    }
                    else {
                        res.status(200);
                        return res.send('Job still processing.');
                    }
                })
            }
        })
});

app.post('/v1/autodock', (req, res) => {
    const storage = new Storage();
    var ligand = null;
    var macromolecule = null;
    var fields = {};
    var errorMsg = "";
    var jobId = crypto.createHmac('SHA256', crypto.randomBytes(48))
    .update(Date.now()
    .toString())
    .digest('hex');
    var uploadDirectory = __dirname + '/uploads/' + jobId;
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
            exePath = path.resolve(__dirname, './vina')
            exec(exePath, args, null, function(error, stdout, stderr) {
                jobUploadCallback = function (err) {
                    if (err) {
                        fs.writeFile(uploadDirectoryClosure + '/error.txt', err, (fsErr) => {
                            if (fsErr) {
                                // Should throw here but we don't have a restarter...
                            }
                            const options = {
                                gzip: 'true',
                                destination: jobIdClosure + '/error.txt'
                            };
                            storage
                                .bucket('autodock-production')
                                .upload(uploadDirectoryClosure + '/error.txt', options, ()=> {
                                    fs.remove(uploadDirectoryClosure);
                                });
                            console.log(err);
                        })
                    }
                    else {
                        fs.remove(uploadDirectoryClosure);
                    }
                };
                if (stderr) {
                    jobUploadCallback(stderr);
                }
                else if (error) {
                    jobUploadCallback(error.toString());
                }
                else {
                    var outputPath = uploadDirectoryClosure + '/output.zip';
                    var output = fs.createWriteStream(outputPath);
                    var archive = archiver('zip', {
                        zlib: { level: 9 }
                    })
                    output.on('close', function () {
                        const options = {
                            gzip: 'true',
                            destination: jobIdClosure + '/output.zip'
                        };
                        storage
                            .bucket('autodock-production')
                            .upload(uploadDirectoryClosure + '/output.zip', options, jobUploadCallback);
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