const express = require('express');
const crypto = require('crypto');
var exec = require('child_process').execFile;
const app = express();
var formidable = require('formidable');
var fs = require('fs');
var archiver = require('archiver')
app.use(express.json())

const REQUIRED_FIELDS = ["center_x","center_y","center_z","size_x","size_y","size_z"];
const OPTIONAL_FIELDS = ["cpu", "seed", "exhaustiveness", "num_modes", "energy_range"];

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
    form.on('fileBegin', function (name, file){
        if (fs.existsSync(uploadDirectory + name + '.pdbqt')) {
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
            errorMsg = 'Unknown file name parameter: ' + name;
        }

    });

    if (errorMsg) {
        res.status(400);
        return res.send(errorMsg);
    }

    form.on('end', function() {
        try {
            args = 
            ['--receptor ', uploadDirectory + '/macromolecule.pdbqt',  
            '--ligand ', uploadDirectory + '/ligand.pdbqt',
            '--log', uploadDirectory + '/log.txt'];
            
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
            exec(`${__dirname}/vina `, args, {shell: true}, function(error, stdout, stderr) {
                if (stderr) {
                    console.log(stderr);
                    // Make this create error.txt
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
            errorMsg = 'Execution error: ' + error;
            res.status(500)
            return res.send(errorMsg)
        }
    });

});

app.listen(8000, () => {
    console.log('Listening on port 8000.')
})