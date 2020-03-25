const express = require('express');
const crypto = require('crypto');
const {Storage} = require('@google-cloud/storage');
var exec = require('child_process').execFile;
const app = express();
var formidable = require('formidable');
var fs = require('fs');
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
    if (!fs.existsSync(__dirname + '/uploads/')) {
        fs.mkdirSync(__dirname + '/uploads/');
    }
    uploadDirectory = __dirname + '/uploads/' + req.query.jobId;
    if (!fs.existsSync(uploadDirectory)) {
        res.status(400);
        return res.send('No job with that ID.');
    }
    if (!fs.existsSync(uploadDirectory + '/ligand_out.pdbqt')) {
        res.status(200);
        return res.send('Job still processing.');
    }
    var outputPath = uploadDirectory + '/output.zip';
    var output = fs.createWriteStream(outputPath);
    var archive = archiver('zip', {
        zlib: { level: 9 }
    })
    output.on('close', function () {
        var stat = fs.statSync(outputPath);
        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': stat.size
        });
        var readStream = fs.createReadStream(outputPath);
        readStream.pipe(res)
    })
    archive.on('error', function (err) {
        res.status(400);
        return res.send('File archiving error.');
    })
    archive.pipe(output)
    results = uploadDirectory + '/ligand_out.pdbqt'
    archive.append(fs.createReadStream(results), { name: 'ligand_out.pdbqt' })
    log = uploadDirectory + '/log.txt'
    archive.append(fs.createReadStream(log), { name: 'log.txt' })
    archive.finalize();

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
    if (!fs.existsSync(__dirname + '/uploads/')) {
        fs.mkdirSync(__dirname + '/uploads/');
    }
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
                if (stderr) {
                    console.log(stderr);
                    // Make this create error.txt
                }
                const options = {
                    gzip: 'true'
                };
                jobUploadCallback = function (err) {
                    // Put error.txt into cloud bucket
                    console.log(err);
                };
                storage
                    .bucket('autodock-production')
                    .upload(uploadDirectory + '/ligand_out.pdbqt', options, jobUploadCallback);
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