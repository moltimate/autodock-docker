const express = require('express');
const crypto = require('crypto');
const {Storage} = require('@google-cloud/storage');
var exec = require('child_process').execFile;
const app = express();
var formidable = require('formidable');
var fs = require('fs-extra');
var archiver = require('archiver')
app.use(express.json())


app.delete('/v1/autodock', (req, res) => {
    res.status('200');
    res.send('Deleted.');
})

app.get('/v1/autodock', (req, res) => {
    if (!req.query.jobId) {
        res.status(400);
        return res.send('Missing required parameter: jobId');
    }
    if (!fs.existsSync(uploadDirectory + '/ligand_out.pdbqt')) {
        res.status(200);
        return res.send('Job still processing.');
    }
    const options = {
        gzip: 'true',
        destination: jobId + '/error.txt'
    };
    storage
        .bucket('autodock-production')
        .download(uploadDirectory + '/error.txt', options, ()=> {
            fs.remove(uploadDirectory);
    });
    temp = crypto.createHmac('SHA256', crypto.randomBytes(48))
    .update(Date.now()
    .toString())
    .digest('hex');
    uploadDirectory = __dirname + '/uploads/' + temp;
    if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory);
    }
    var outputPath = uploadDirectory + '/output.zip';
    var stat = fs.statSync(outputPath);
    res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': stat.size
    });
    var readStream = fs.createReadStream(outputPath);
    readStream.pipe(res)

});

app.post('/v1/autodock', (req, res) => {
    const storage = new Storage();
    ligand = null;
    macromolecule = null;
    fields = {};
    errorMsg = "";
    jobId = crypto.createHmac('SHA256', crypto.randomBytes(48))
    .update(Date.now()
    .toString())
    .digest('hex');
    uploadDirectory = __dirname + '/uploads/' + jobId;
    if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory);
    }
    else {
        res.status(400);
        errorMsg = 'Hash collision.';
    }
    var form = new formidable.IncomingForm();
    form.multiples = true;
    form.parse(req);
    form.on('field', function(name, value) {
        fields[name] = value
    })
    form.on('fileBegin', function (name, file){
        if (fs.existsSync(uploadDirectory + name + '.pdbqt')) {
            res.status(400);
            errorMsg = 'Multiple files with same name uploaded?';
        }
        if (name == 'ligand') {
            ligand = file.name        
            file.path = uploadDirectory + '/' + 'ligand.pdbqt';
        }
        else if (name == 'macromolecule') {
            macromolecule = file.name
            file.path = uploadDirectory + '/' + 'macromolecule.pdbqt';
        }
        else {
            res.status(400);
            errorMsg = 'Unknown file name parameter: ' + name;
        }

    });
    form.on('end', function() {
        if (errorMsg) {
            res.send(errorMsg);
        }
        try {
            args = 
            ['--receptor ', uploadDirectory + '/macromolecule.pdbqt',  
            '--ligand ', uploadDirectory + '/ligand.pdbqt',
            '--center_x', fields['center_x'],
            '--center_y', fields['center_y'],
            '--center_z', fields['center_z'],
            '--size_x', fields['size_x'],
            '--size_y', fields['size_y'],
            '--size_z', fields['size_z'],
            '--log', uploadDirectory + '/log.txt']
        }
        catch(err) {
            res.status(400)
            errorMsg = 'Incorrect arguments provided.';
        }
        try {
            exec(`${__dirname}/vina `, args, {shell: true}, function(error, stdout, stderr) {
                jobUploadCallback = function (err) {
                    if (err) {
                        fs.writeFile(uploadDirectory + '/error.txt', err, (fsErr) => {
                            if (fsErr) {
                                // Should throw here but we don't have a restarter...
                            }
                            const options = {
                                gzip: 'true',
                                destination: jobId + '/error.txt'
                            };
                            storage
                                .bucket('autodock-production')
                                .upload(uploadDirectory + '/error.txt', options, ()=> {
                                    fs.remove(uploadDirectory);
                                });
                            console.log(err);
                        })
                    }
                    else {
                        fs.remove(uploadDirectory);
                    }
                };
                if (stderr) {
                    jobUploadCallback(stderr);
                }
                else {
                    var outputPath = uploadDirectory + '/output.zip';
                    var output = fs.createWriteStream(outputPath);
                    var archive = archiver('zip', {
                        zlib: { level: 9 }
                    })
                    output.on('close', function () {
                        const options = {
                            gzip: 'true',
                            destination: jobId + '/output.zip'
                        };
                        storage
                            .bucket('autodock-production')
                            .upload(uploadDirectory + '/output.zip', options, jobUploadCallback);
                    })
                    archive.on('error', jobUploadCallback)
                    archive.pipe(output)
                    results = uploadDirectory + '/ligand_out.pdbqt'
                    archive.append(fs.createReadStream(results), { name: 'ligand_out.pdbqt' })
                    log = uploadDirectory + '/log.txt'
                    archive.append(fs.createReadStream(log), { name: 'log.txt' })
                    archive.finalize();
                }
            });
            response = {
                'jobId': jobId,
                'macromolecule': macromolecule,
                'ligand': ligand
            }
            res.status(200);
            res.send(response);
        }
        catch(error) {
            res.status(400)
            errorMsg = 'Execution error: ' + error;
        }
    });

});

app.listen(8000, () => {
    console.log('Listening on port 8000.')
})