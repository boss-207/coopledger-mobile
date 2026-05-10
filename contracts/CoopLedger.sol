// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CoopLedger {

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum Role { AUCUN, MEMBRE, TRESORIER, PRESIDENT }

    enum StatutTransaction { EN_ATTENTE_VOTE, VALIDE, REJETE, ANNULE }

    enum StatutVote { OUVERT, APPROUVE, REJETE, ANNULE }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Membre {
        address wallet;
        string nom;
        Role role;
        bool actif;
    }

    struct Transaction {
        uint256 id;
        string titre;
        uint256 montant;       // en FCFA (1 FCFA = 1 unité)
        string categorie;
        string typeTransaction; // "entree" ou "sortie"
        address creePar;
        uint256 timestamp;
        StatutTransaction statut;
        bool voteDeclenche;
    }

    struct VoteSession {
        uint256 transactionId;
        string titre;
        uint256 montant;
        uint256 votesOui;
        uint256 votesNon;
        uint256 openedAt;
        uint256 expiresAt;
        StatutVote statut;
        uint256 totalMembresAuMomentDuVote;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    address public president;

    uint256 public constant SEUIL_VOTE = 500_000;
    uint256 public constant DUREE_VOTE = 30 minutes;
    uint256 public constant QUORUM_PCT = 60;

    mapping(address => Membre) public membres;
    address[] public listeAdresses;
    uint256 public nombreMembresActifs;

    Transaction[] public transactions;
    VoteSession[] public votes;

    // voteId par transactionId (0 = pas de vote, index+1)
    mapping(uint256 => uint256) public voteParTransaction;

    // aVote[voteId][adresse]
    mapping(uint256 => mapping(address => bool)) public aVote;

    // ─── Events ───────────────────────────────────────────────────────────────

    event TransactionEnregistree(
        uint256 indexed transactionId,
        address indexed creePar,
        uint256 montant,
        bool voteDeclenche
    );

    event VoteEnregistre(
        uint256 indexed transactionId,
        uint256 indexed voteId,
        address indexed votant,
        bool choixOui,
        uint256 votesOui,
        uint256 votesNon,
        StatutVote statutVote
    );

    event VoteFinalise(
        uint256 indexed transactionId,
        uint256 indexed voteId,
        StatutVote resultat
    );

    event MembreAjoute(address indexed wallet, string nom, Role role);
    event MembreRetire(address indexed wallet);
    event RoleModifie(address indexed wallet, Role ancienRole, Role nouveauRole);
    event PresidenceTransferee(address indexed ancienPresident, address indexed nouveauPresident);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _president, string memory _nomPresident) {
        president = _president;
        membres[_president] = Membre({
            wallet: _president,
            nom: _nomPresident,
            role: Role.PRESIDENT,
            actif: true
        });
        listeAdresses.push(_president);
        nombreMembresActifs = 1;
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier seulementPresident() {
        require(membres[msg.sender].role == Role.PRESIDENT, "Seul le president peut effectuer cette action");
        _;
    }

    modifier membreAutorise() {
        require(membres[msg.sender].actif, "Vous n'etes pas membre de cette cooperative");
        _;
    }

    modifier peutCreerTransaction() {
        Role r = membres[msg.sender].role;
        require(
            r == Role.PRESIDENT || r == Role.TRESORIER,
            "Seuls le president et le tresorier peuvent creer des transactions"
        );
        _;
    }

    // ─── Administration membres/roles ─────────────────────────────────────────

    function addMember(address wallet, string calldata nom) external seulementPresident {
        require(wallet != address(0), "Adresse invalide");
        require(!membres[wallet].actif, "Ce membre est deja actif");

        if (membres[wallet].wallet == address(0)) {
            listeAdresses.push(wallet);
        }
        membres[wallet] = Membre({ wallet: wallet, nom: nom, role: Role.MEMBRE, actif: true });
        nombreMembresActifs++;

        emit MembreAjoute(wallet, nom, Role.MEMBRE);
    }

    function removeMember(address wallet) external seulementPresident {
        require(wallet != president, "Impossible de retirer le president actif");
        require(membres[wallet].actif, "Ce membre n'est pas actif");

        membres[wallet].actif = false;
        nombreMembresActifs--;

        emit MembreRetire(wallet);
    }

    function setRole(address wallet, Role nouveauRole) external seulementPresident {
        require(membres[wallet].actif, "Membre inactif ou inexistant");
        require(nouveauRole != Role.AUCUN, "Role invalide");
        require(nouveauRole != Role.PRESIDENT, "Utiliser transferPresidence pour changer de president");

        if (membres[wallet].role == Role.TRESORIER && nouveauRole != Role.TRESORIER) {
            // retire l'ancien trésorier
        }

        Role ancienRole = membres[wallet].role;
        membres[wallet].role = nouveauRole;

        emit RoleModifie(wallet, ancienRole, nouveauRole);
    }

    function transferPresidence(address nouveauPresident) external seulementPresident {
        require(membres[nouveauPresident].actif, "Le nouveau president doit etre un membre actif");
        require(nouveauPresident != president, "C'est deja le president");

        address ancienPresident = president;

        membres[ancienPresident].role = Role.MEMBRE;
        membres[nouveauPresident].role = Role.PRESIDENT;
        president = nouveauPresident;

        emit PresidenceTransferee(ancienPresident, nouveauPresident);
    }

    // ─── Transactions ─────────────────────────────────────────────────────────

    function enregistrerTransaction(
        string calldata titre,
        uint256 montant,
        string calldata categorie,
        string calldata typeTransaction
    ) external peutCreerTransaction membreAutorise returns (uint256 transactionId) {
        require(montant > 0, "Montant doit etre positif");
        require(bytes(titre).length > 0, "Titre requis");

        transactionId = transactions.length;
        bool voteNecessaire = montant > SEUIL_VOTE;

        transactions.push(Transaction({
            id: transactionId,
            titre: titre,
            montant: montant,
            categorie: categorie,
            typeTransaction: typeTransaction,
            creePar: msg.sender,
            timestamp: block.timestamp,
            statut: voteNecessaire ? StatutTransaction.EN_ATTENTE_VOTE : StatutTransaction.VALIDE,
            voteDeclenche: voteNecessaire
        }));

        if (voteNecessaire) {
            uint256 voteId = votes.length;
            votes.push(VoteSession({
                transactionId: transactionId,
                titre: titre,
                montant: montant,
                votesOui: 0,
                votesNon: 0,
                openedAt: block.timestamp,
                expiresAt: block.timestamp + DUREE_VOTE,
                statut: StatutVote.OUVERT,
                totalMembresAuMomentDuVote: nombreMembresActifs
            }));
            voteParTransaction[transactionId] = voteId + 1; // +1 pour distinguer "pas de vote"
        }

        emit TransactionEnregistree(transactionId, msg.sender, montant, voteNecessaire);
    }

    // ─── Votes ────────────────────────────────────────────────────────────────

    function voterOui(uint256 transactionId) external membreAutorise {
        _voter(transactionId, true);
    }

    function voterNon(uint256 transactionId) external membreAutorise {
        _voter(transactionId, false);
    }

    function _voter(uint256 transactionId, bool choix) internal {
        require(transactionId < transactions.length, "Transaction inexistante");

        uint256 voteIndex1 = voteParTransaction[transactionId];
        require(voteIndex1 > 0, "Aucun vote pour cette transaction");

        uint256 voteId = voteIndex1 - 1;
        VoteSession storage v = votes[voteId];

        // Vérifier expiration
        if (v.statut == StatutVote.OUVERT && block.timestamp > v.expiresAt) {
            v.statut = StatutVote.ANNULE;
            transactions[transactionId].statut = StatutTransaction.ANNULE;
            emit VoteFinalise(transactionId, voteId, StatutVote.ANNULE);
            revert("Ce vote a expire sans atteindre le quorum");
        }

        require(v.statut == StatutVote.OUVERT, "Ce vote n'est plus ouvert");
        require(!aVote[voteId][msg.sender], "Vous avez deja vote");

        aVote[voteId][msg.sender] = true;

        if (choix) {
            v.votesOui++;
        } else {
            v.votesNon++;
        }

        uint256 totalVotes = v.votesOui + v.votesNon;
        uint256 participation = (totalVotes * 100) / v.totalMembresAuMomentDuVote;

        emit VoteEnregistre(transactionId, voteId, msg.sender, choix, v.votesOui, v.votesNon, v.statut);

        if (participation >= QUORUM_PCT) {
            StatutVote resultat = v.votesOui > v.votesNon ? StatutVote.APPROUVE : StatutVote.REJETE;
            v.statut = resultat;
            transactions[transactionId].statut = resultat == StatutVote.APPROUVE
                ? StatutTransaction.VALIDE
                : StatutTransaction.REJETE;
            emit VoteFinalise(transactionId, voteId, resultat);
        }
    }

    // ─── Lectures (view, gratuites) ───────────────────────────────────────────

    function getTransaction(uint256 id) external view returns (Transaction memory) {
        require(id < transactions.length, "Transaction inexistante");
        return transactions[id];
    }

    function getVote(uint256 transactionId) external view returns (VoteSession memory) {
        require(transactionId < transactions.length, "Transaction inexistante");
        uint256 voteIndex1 = voteParTransaction[transactionId];
        require(voteIndex1 > 0, "Aucun vote pour cette transaction");
        return votes[voteIndex1 - 1];
    }

    function getVoteId(uint256 transactionId) external view returns (uint256) {
        uint256 voteIndex1 = voteParTransaction[transactionId];
        require(voteIndex1 > 0, "Aucun vote pour cette transaction");
        return voteIndex1 - 1;
    }

    function getSolde() external view returns (int256 solde) {
        solde = 0;
        for (uint256 i = 0; i < transactions.length; i++) {
            Transaction memory t = transactions[i];
            if (t.statut == StatutTransaction.VALIDE) {
                bytes32 typeHash = keccak256(bytes(t.typeTransaction));
                if (typeHash == keccak256(bytes("entree")) || typeHash == keccak256(bytes("revenu"))) {
                    solde += int256(t.montant);
                } else {
                    solde -= int256(t.montant);
                }
            }
        }
    }

    function getToutesTransactions() external view returns (Transaction[] memory) {
        return transactions;
    }

    function getTousVotes() external view returns (VoteSession[] memory) {
        return votes;
    }

    function getMembres() external view returns (Membre[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < listeAdresses.length; i++) {
            if (membres[listeAdresses[i]].actif) count++;
        }
        Membre[] memory actifs = new Membre[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < listeAdresses.length; i++) {
            if (membres[listeAdresses[i]].actif) {
                actifs[j++] = membres[listeAdresses[i]];
            }
        }
        return actifs;
    }

    function getMembre(address wallet) external view returns (Membre memory) {
        return membres[wallet];
    }

    function nombreTransactions() external view returns (uint256) {
        return transactions.length;
    }

    function nombreVotes() external view returns (uint256) {
        return votes.length;
    }

    function estExpire(uint256 transactionId) external view returns (bool) {
        uint256 voteIndex1 = voteParTransaction[transactionId];
        if (voteIndex1 == 0) return false;
        VoteSession memory v = votes[voteIndex1 - 1];
        return v.statut == StatutVote.OUVERT && block.timestamp > v.expiresAt;
    }
}
