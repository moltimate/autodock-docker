const express = require('express');
const crypto = require('crypto');
var exec = require('child_process').execFile;
const app = express();
var formidable = require('formidable');
var fs = require('fs');
app.use(express.json())

app.get('/v1/autodock', (req, res) => {
    res.send('Hello World!')
});

app.post('/v1/autodock', (req, res) => {
    ligend = null
    macromolecule = null
    fields = {}
    let uploadDirectory = __dirname + '/uploads/' + crypto.createHmac('sha1', crypto.randomBytes(48))
        .update(Date.now()
        .toString())
        .digest('hex');
    if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory);
    }
    else {
        res.status(400);
        res.send('Hash collision.');
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
            res.send('Multiple files with same name uploaded?');
        }
        if (name == 'ligend') {
            ligend = file.name
        }
        else if (name == 'macromolecule') {
            macromolecule = file.name
        }
        else {
            res.status(400);
            res.send('Unknown file name parameter: ' + name);
        }
        file.path = uploadDirectory + '/' + file.name;
    });
    form.on('end', function() {
        try {
            var args = []
            var options = []
            args.push()
            argsString = 
            ' --receptor ' +  uploadDirectory + '/' + macromolecule +  
            ' --ligand ' +  uploadDirectory + '/' + ligend +
            ' --center_x ' + fields['center_x'] +
            ' --center_y ' + fields['center_y'] +
            ' --center_z ' + fields['center_z'] +
            ' --size_x ' + fields['size_x'] +
            ' --size_y ' + fields['size_y'] +
            ' --size_z ' + fields['size_z'] 
        }
        catch(err) {
            res.status(400)
            res.send('Incorrect arguments provided.')
        }
        try {
            exec(`${__dirname}/vina ` + argsString, [], {shell: true}, function(error, stdout, stderr) {
                console.log(stdout)
                console.log(stderr)
                console.log(error)
            });
        }
        catch(error) {
            res.status(400)
            res.send('Execution error: ' + error)
        }
    });

});

app.listen(8000, () => {
    console.log('Listening on port 8000.')
})